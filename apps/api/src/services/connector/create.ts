import { eq } from "drizzle-orm";
import { routerConnections, auditEvents } from "../../db/schema";
import { AppError } from "../../lib/errors";
import { sealSecret } from "../../lib/crypto";
import type { ConnectorDTO } from "@shared/index";
import type { SshProbeResult } from "../ssh-probe";
import { targetError, probeError } from "./errors";
import { toDTO } from "./dto";
import { ensurePermission } from "./ownership";
import type { ConnectorCtx } from "./types";

export async function createConnector(
  ctx: ConnectorCtx,
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
  const decision = await ctx.targetPolicy.check(input.host);
  if (!decision.allowed) {
    throw targetError(decision.reason);
  }

  // 2. Auth-check SSH BEFORE persisting anything
  const probe = await ctx.probeFn({
    host: input.host,
    port: input.port,
    username: input.username,
    password: input.password,
    expectFingerprint: null,
    timeoutMs: ctx.sshTimeoutMs,
  });
  if (!probe.ok) {
    throw probeError(probe);
  }

  // 3. Persist connection with encrypted credential
  const [conn] = await ctx.db
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
      rosVersion: probe.rosVersion ?? null,
      boardName: probe.boardName ?? null,
      architecture: probe.architecture ?? null,
      managementInterface: probe.managementInterface ?? null,
      hostKeyFingerprint: probe.fingerprint,
    })
    .returning();
  if (!conn) throw new AppError("INTERNAL_ERROR", "Gagal menyimpan connector.", 500);

  // password sealed to (userId, connectionId) — only after the probe succeeded
  const sealed = sealSecret(ctx.keyRing, input.password, userId, conn.id);
  await ctx.db
    .update(routerConnections)
    .set({
      passwordCiphertext: sealed.ciphertext,
      passwordNonce: sealed.nonce,
      passwordAuthTag: sealed.authTag,
      keyVersion: sealed.keyVersion,
    })
    .where(eq(routerConnections.id, conn.id));

  await ensurePermission(ctx, userId, conn.id);
  await ctx.db.insert(auditEvents).values({
    userId,
    action: "connector.created",
    connectionId: conn.id,
    metadata: { host: input.host, port: input.port, routerIdentity: probe.routerIdentity },
  });

  return { connector: toDTO(conn, "read-only", 1), probe };
}
