import { and, eq } from "drizzle-orm";
import { routerConnections, connectionPermissions, auditEvents } from "../../db/schema";
import { sealSecret } from "../../lib/crypto";
import type { ConnectorDTO } from "@shared/index";
import { targetError, probeError } from "./errors";
import { toDTO } from "./dto";
import { ensurePermission, requireOwned } from "./ownership";
import { openExisting } from "./credentials";
import type { ConnectorCtx } from "./types";

export async function connectRouter(ctx: ConnectorCtx, userId: string, connectionId: string): Promise<ConnectorDTO> {
  const row = await requireOwned(ctx, userId, connectionId)();
  const password = openExisting(ctx, userId, row);
  const decision = await ctx.targetPolicy.check(row.host);
  if (!decision.allowed) throw targetError(decision.reason);
  const probe = await ctx.probeFn({
    host: row.host,
    port: row.port,
    username: row.username,
    password,
    expectFingerprint: row.hostKeyFingerprint,
    timeoutMs: ctx.sshTimeoutMs,
  });
  if (!probe.ok) {
    // reflect real status, do not silently keep "connected"
    await ctx.db
      .update(routerConnections)
      .set({ status: "failed", updatedAt: new Date() })
      .where(eq(routerConnections.id, connectionId));
    throw probeError(probe);
  }
  const [updated] = await ctx.db
    .update(routerConnections)
    .set({
      status: "connected",
      lastVerifiedAt: new Date(),
      updatedAt: new Date(),
      routerIdentity: probe.routerIdentity ?? row.routerIdentity,
      rosVersion: probe.rosVersion ?? row.rosVersion,
      boardName: probe.boardName ?? row.boardName,
      architecture: probe.architecture ?? row.architecture,
      managementInterface: probe.managementInterface ?? row.managementInterface,
    })
    .where(eq(routerConnections.id, connectionId))
    .returning();
  // key rotation: re-seal under the current key version when the stored
  // record still uses an older one (password is already open here)
  if (row.keyVersion < ctx.keyRing.currentVersion) {
    const sealed = sealSecret(ctx.keyRing, password, userId, connectionId);
    await ctx.db
      .update(routerConnections)
      .set({
        passwordCiphertext: sealed.ciphertext,
        passwordNonce: sealed.nonce,
        passwordAuthTag: sealed.authTag,
        keyVersion: sealed.keyVersion,
      })
      .where(eq(routerConnections.id, connectionId));
  }
  const perm = await ensurePermission(ctx, userId, connectionId);
  return toDTO(updated ?? row, perm.writeEnabled ? "write" : "read-only", perm.version);
}

export async function disconnectRouter(ctx: ConnectorCtx, userId: string, connectionId: string): Promise<ConnectorDTO> {
  const row = await requireOwned(ctx, userId, connectionId)();
  // revoke write, then mark disconnected
  await ctx.db
    .update(connectionPermissions)
    .set({ writeEnabled: false, updatedAt: new Date() })
    .where(
      and(
        eq(connectionPermissions.userId, userId),
        eq(connectionPermissions.connectionId, connectionId),
      ),
    );
  const [updated] = await ctx.db
    .update(routerConnections)
    .set({ status: "disconnected", updatedAt: new Date() })
    .where(eq(routerConnections.id, connectionId))
    .returning();
  await ctx.db.insert(auditEvents).values({ userId, action: "connector.disconnected", connectionId });
  const perm = await ensurePermission(ctx, userId, connectionId);
  return toDTO(updated ?? row, "read-only", perm.version);
}
