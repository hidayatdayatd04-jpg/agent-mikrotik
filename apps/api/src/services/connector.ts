import { and, eq } from "drizzle-orm";
import type { Database } from "../db";
import { routerConnections, connectionPermissions, auditEvents } from "../db/schema";
import { AppError } from "../lib/errors";
import type { ApiErrorCode } from "@shared/index";
import { sealSecret, openSecret, type KeyRing, type SealedSecret } from "../lib/crypto";
import type { TargetPolicy } from "./target-policy";
import { probeRouter, type SshProbeResult } from "./ssh-probe";
import type { ConnectorDTO, RouterMode } from "@shared/index";

export interface ConnectorServiceDeps {
  db: Database;
  keyRing: KeyRing;
  targetPolicy: TargetPolicy;
  sshTimeoutMs: number;
  log: (msg: string, data?: unknown) => void;
  /** Injectable for tests; defaults to the real ssh2 probe. */
  probe?: (opts: import("./ssh-probe").SshProbeOptions) => Promise<import("./ssh-probe").SshProbeResult>;
}

export function createConnectorService(deps: ConnectorServiceDeps) {
  const { db } = deps;
  const probeFn = deps.probe ?? probeRouter;

  function requireOwned(userId: string, connectionId: string) {
    return async () => {
      const [conn] = await db
        .select()
        .from(routerConnections)
        .where(and(eq(routerConnections.id, connectionId), eq(routerConnections.userId, userId)))
        .limit(1);
      if (!conn) throw new AppError("NOT_FOUND", "Connector tidak ditemukan.", 404);
      return conn;
    };
  }

  async function ensurePermission(userId: string, connectionId: string) {
    const [perm] = await db
      .select()
      .from(connectionPermissions)
      .where(
        and(
          eq(connectionPermissions.userId, userId),
          eq(connectionPermissions.connectionId, connectionId),
        ),
      )
      .limit(1);
    if (!perm) {
      // write_enabled defaults to false (read-only) on creation
      await db
        .insert(connectionPermissions)
        .values({ userId, connectionId, writeEnabled: false })
        .onConflictDoNothing();
      return { writeEnabled: false, version: 1 };
    }
    return { writeEnabled: perm.writeEnabled, version: perm.version };
  }

  async function list(userId: string): Promise<ConnectorDTO[]> {
    const rows = await db
      .select()
      .from(routerConnections)
      .where(eq(routerConnections.userId, userId));
    const out: ConnectorDTO[] = [];
    for (const row of rows) {
      const perm = await ensurePermission(userId, row.id);
      out.push(toDTO(row, perm.writeEnabled ? "write" : "read-only", perm.version));
    }
    return out;
  }

  async function create(
    userId: string,
    input: {
      label: string;
      host: string;
      port: number;
      username: string;
      password: string;
    },
  ): Promise<{ connector: ConnectorDTO; probe: SshProbeResult }> {
    // 1. Target policy check (before any connection attempt)
    const decision = await deps.targetPolicy.check(input.host);
    if (!decision.allowed) {
      throw targetError(decision.reason);
    }

    // 2. Auth-check SSH BEFORE persisting anything
    const probe = await probeFn({
      host: input.host,
      port: input.port,
      username: input.username,
      password: input.password,
      expectFingerprint: null,
      timeoutMs: deps.sshTimeoutMs,
    });
    if (!probe.ok) {
      throw probeError(probe);
    }

    // 3. Persist connection with encrypted credential
    const [conn] = await db
      .insert(routerConnections)
      .values({
        userId,
        label: input.label,
        host: input.host,
        port: input.port,
        username: input.username,
        status: "connected",
        lastVerifiedAt: new Date(),
        routerIdentity: probe.routerIdentity,
        hostKeyFingerprint: probe.fingerprint,
      })
      .returning();
    if (!conn) throw new AppError("INTERNAL_ERROR", "Gagal menyimpan connector.", 500);

    // password sealed to (userId, connectionId) — only after the probe succeeded
    const sealed = sealSecret(deps.keyRing, input.password, userId, conn.id);
    await db
      .update(routerConnections)
      .set({
        passwordCiphertext: sealed.ciphertext,
        passwordNonce: sealed.nonce,
        passwordAuthTag: sealed.authTag,
        keyVersion: sealed.keyVersion,
      })
      .where(eq(routerConnections.id, conn.id));

    await ensurePermission(userId, conn.id);
    await db.insert(auditEvents).values({
      userId,
      action: "connector.created",
      connectionId: conn.id,
      metadata: { host: input.host, port: input.port, routerIdentity: probe.routerIdentity },
    });

    return { connector: toDTO(conn, "read-only", 1), probe };
  }

  async function update(
    userId: string,
    connectionId: string,
    input: {
      label?: string;
      host?: string;
      port?: number;
      username?: string;
      password?: string;
    },
  ): Promise<{ connector: ConnectorDTO; probe: SshProbeResult }> {
    const existing = await requireOwned(userId, connectionId)();
    const nextHost = input.host ?? existing.host;
    const nextPort = input.port ?? existing.port;
    const nextUsername = input.username ?? existing.username;
    const credsChanged = input.host !== undefined || input.port !== undefined || input.username !== undefined;

    let probe: SshProbeResult = { ok: true, kind: "ok", fingerprint: null, routerIdentity: existing.routerIdentity, message: "tidak berubah" };

    if (credsChanged || input.password !== undefined) {
      const decision = await deps.targetPolicy.check(nextHost);
      if (!decision.allowed) throw targetError(decision.reason);

      // test with new credentials (old password if not replaced)
      const password = input.password ?? openExisting(userId, existing);
      probe = await probeFn({
        host: nextHost,
        port: nextPort,
        username: nextUsername,
        password,
        expectFingerprint: existing.hostKeyFingerprint,
        timeoutMs: deps.sshTimeoutMs,
      });
      if (!probe.ok) throw probeError(probe);
    }

    const [updated] = await db
      .update(routerConnections)
      .set({
        label: input.label ?? existing.label,
        host: nextHost,
        port: nextPort,
        username: nextUsername,
        status: "connected",
        lastVerifiedAt: new Date(),
        routerIdentity: probe.routerIdentity ?? existing.routerIdentity,
        ...(input.password !== undefined
          ? (() => {
              const sealed = sealSecret(deps.keyRing, input.password, userId, connectionId);
              return {
                passwordCiphertext: sealed.ciphertext,
                passwordNonce: sealed.nonce,
                passwordAuthTag: sealed.authTag,
                keyVersion: sealed.keyVersion,
              };
            })()
          : {}),
      })
      .where(and(eq(routerConnections.id, connectionId), eq(routerConnections.userId, userId)))
      .returning();
    if (!updated) throw new AppError("INTERNAL_ERROR", "Gagal memperbarui connector.", 500);

    const perm = await ensurePermission(userId, connectionId);
    await db.insert(auditEvents).values({
      userId,
      action: "connector.updated",
      connectionId,
      metadata: { credsChanged, hostChanged: input.host !== undefined },
    });
    return {
      connector: toDTO(updated, perm.writeEnabled ? "write" : "read-only", perm.version),
      probe,
    };
  }

  function openExisting(userId: string, row: typeof routerConnections.$inferSelect): string {
    if (!row.passwordCiphertext || !row.passwordNonce || !row.passwordAuthTag) {
      throw new AppError("INTERNAL_ERROR", "Kredensial tersimpan tidak lengkap.", 500);
    }
    const sealed: SealedSecret = {
      ciphertext: row.passwordCiphertext,
      nonce: row.passwordNonce,
      authTag: row.passwordAuthTag,
      keyVersion: row.keyVersion,
    };
    const pw = openSecret(deps.keyRing, sealed, userId, row.id);
    if (pw === null) throw new AppError("INTERNAL_ERROR", "Dekripsi kredensial gagal (key rotated?).", 500);
    return pw;
  }

  async function decryptCredential(userId: string, connectionId: string): Promise<string> {
    const row = await requireOwned(userId, connectionId)();
    return openExisting(userId, row);
  }

  async function connect(userId: string, connectionId: string): Promise<ConnectorDTO> {
    const row = await requireOwned(userId, connectionId)();
    const password = openExisting(userId, row);
    const decision = await deps.targetPolicy.check(row.host);
    if (!decision.allowed) throw targetError(decision.reason);
    const probe = await probeFn({
      host: row.host,
      port: row.port,
      username: row.username,
      password,
      expectFingerprint: row.hostKeyFingerprint,
      timeoutMs: deps.sshTimeoutMs,
    });
    if (!probe.ok) {
      // reflect real status, do not silently keep "connected"
      await db
        .update(routerConnections)
        .set({ status: "failed", updatedAt: new Date() })
        .where(eq(routerConnections.id, connectionId));
      throw probeError(probe);
    }
    const [updated] = await db
      .update(routerConnections)
      .set({ status: "connected", lastVerifiedAt: new Date(), updatedAt: new Date() })
      .where(eq(routerConnections.id, connectionId))
      .returning();
    // key rotation: re-seal under the current key version when the stored
    // record still uses an older one (password is already open here)
    if (row.keyVersion < deps.keyRing.currentVersion) {
      const sealed = sealSecret(deps.keyRing, password, userId, connectionId);
      await db
        .update(routerConnections)
        .set({
          passwordCiphertext: sealed.ciphertext,
          passwordNonce: sealed.nonce,
          passwordAuthTag: sealed.authTag,
          keyVersion: sealed.keyVersion,
        })
        .where(eq(routerConnections.id, connectionId));
    }
    const perm = await ensurePermission(userId, connectionId);
    return toDTO(updated ?? row, perm.writeEnabled ? "write" : "read-only", perm.version);
  }

  async function disconnect(userId: string, connectionId: string): Promise<ConnectorDTO> {
    const row = await requireOwned(userId, connectionId)();
    // revoke write, then mark disconnected
    await db
      .update(connectionPermissions)
      .set({ writeEnabled: false, updatedAt: new Date() })
      .where(
        and(
          eq(connectionPermissions.userId, userId),
          eq(connectionPermissions.connectionId, connectionId),
        ),
      );
    const [updated] = await db
      .update(routerConnections)
      .set({ status: "disconnected", updatedAt: new Date() })
      .where(eq(routerConnections.id, connectionId))
      .returning();
    await db.insert(auditEvents).values({ userId, action: "connector.disconnected", connectionId });
    const perm = await ensurePermission(userId, connectionId);
    return toDTO(updated ?? row, "read-only", perm.version);
  }

  async function setMode(
    userId: string,
    connectionId: string,
    mode: RouterMode,
    expectedVersion: number,
  ): Promise<{ connector: ConnectorDTO; version: number }> {
    await requireOwned(userId, connectionId)();
    // compare-and-set on version
    const updated = await db
      .update(connectionPermissions)
      .set({
        writeEnabled: mode === "write",
        version: expectedVersion + 1,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(connectionPermissions.userId, userId),
          eq(connectionPermissions.connectionId, connectionId),
          eq(connectionPermissions.version, expectedVersion),
        ),
      )
      .returning();
    if (updated.length === 0) {
      throw new AppError("POLICY_CHANGED", "Mode berubah di sesi/tab lain. Muat ulang status connector.", 409);
    }
    const row = await requireOwned(userId, connectionId)();
    await db.insert(auditEvents).values({
      userId,
      action: mode === "write" ? "connector.write_enabled" : "connector.write_disabled",
      connectionId,
    });
    return {
      connector: toDTO(row, mode, expectedVersion + 1),
      version: expectedVersion + 1,
    };
  }

  async function getMode(userId: string, connectionId: string): Promise<{ mode: RouterMode; version: number }> {
    await requireOwned(userId, connectionId)();
    const perm = await ensurePermission(userId, connectionId);
    return { mode: perm.writeEnabled ? "write" : "read-only", version: perm.version };
  }

  async function remove(userId: string, connectionId: string): Promise<void> {
    const row = await requireOwned(userId, connectionId)();
    await db.delete(routerConnections).where(eq(routerConnections.id, connectionId));
    await db.insert(auditEvents).values({
      userId,
      action: "connector.deleted",
      connectionId,
      metadata: { host: row.host },
    });
  }

  function toDTO(
    row: typeof routerConnections.$inferSelect,
    mode: RouterMode,
    version: number,
  ): ConnectorDTO {
    return {
      id: row.id,
      label: row.label,
      host: row.host,
      port: row.port,
      username: row.username,
      status: row.status as ConnectorDTO["status"],
      mode,
      modeVersion: version,
      hostKeyFingerprint: row.hostKeyFingerprint,
      lastVerifiedAt: row.lastVerifiedAt?.toISOString() ?? null,
      routerIdentity: row.routerIdentity,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  return {
    list,
    create,
    update,
    connect,
    disconnect,
    setMode,
    getMode,
    remove,
    decryptCredential,
    requireOwned,
  };
}

function targetError(reason: string): AppError {
  const messages: Record<string, string> = {
    loopback: "Alamat loopback tidak diizinkan sebagai target router.",
    "link-local": "Alamat link-local tidak diizinkan.",
    multicast: "Alamat multicast tidak diizinkan.",
    metadata: "Alamat metadata cloud tidak diizinkan.",
    "not-in-allowlist": "Alamat router tidak berada dalam daftar jaringan yang diizinkan.",
    unresolvable: "Hostname router tidak dapat diselesaikan (DNS).",
  };
  return new AppError("HOST_NOT_ALLOWED", messages[reason] ?? "Target tidak diizinkan.", 400);
}

function probeError(probe: SshProbeResult): AppError {
  const map: Record<SshProbeResult["kind"], { code: ApiErrorCode; status: number }> = {
    ok: { code: "INTERNAL_ERROR", status: 500 },
    "auth-failed": { code: "SSH_AUTH_FAILED", status: 400 },
    unreachable: { code: "SSH_UNREACHABLE", status: 502 },
    timeout: { code: "SSH_TIMEOUT", status: 504 },
    refused: { code: "SSH_UNREACHABLE", status: 502 },
    "hostkey-changed": { code: "HOST_KEY_CHANGED", status: 400 },
    unknown: { code: "INTERNAL_ERROR", status: 500 },
  };
  const mapped = map[probe.kind];
  return new AppError(mapped.code, probe.message, mapped.status);
}

export type ConnectorService = ReturnType<typeof createConnectorService>;
