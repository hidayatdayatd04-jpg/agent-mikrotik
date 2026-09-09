import { and, eq } from "drizzle-orm";
import { routerConnections, auditEvents } from "../../db/schema";
import { AppError } from "../../lib/errors";
import { sealSecret } from "../../lib/crypto";
import type { ConnectorDTO } from "@shared/index";
import type { SshProbeResult } from "../ssh-probe";
import { targetError, probeError } from "./errors";
import { toDTO } from "./dto";
import { ensurePermission, requireOwned } from "./ownership";
import { openExisting } from "./credentials";
import type { ConnectorCtx } from "./types";

export async function updateConnector(
  ctx: ConnectorCtx,
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
  const existing = await requireOwned(ctx, userId, connectionId)();
  const nextHost = input.host ?? existing.host;
  const nextPort = input.port ?? existing.port;
  const nextUsername = input.username ?? existing.username;
  const credsChanged = input.host !== undefined || input.port !== undefined || input.username !== undefined;

  let probe: SshProbeResult = { ok: true, kind: "ok", fingerprint: null, routerIdentity: existing.routerIdentity, message: "tidak berubah" };

  if (credsChanged || input.password !== undefined) {
    const decision = await ctx.targetPolicy.check(nextHost);
    if (!decision.allowed) throw targetError(decision.reason);

    // test with new credentials (old password if not replaced)
    const password = input.password ?? openExisting(ctx, userId, existing);
    probe = await ctx.probeFn({
      host: nextHost,
      port: nextPort,
      username: nextUsername,
      password,
      expectFingerprint: existing.hostKeyFingerprint,
      timeoutMs: ctx.sshTimeoutMs,
    });
    if (!probe.ok) throw probeError(probe);
  }

  const [updated] = await ctx.db
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
            const sealed = sealSecret(ctx.keyRing, input.password, userId, connectionId);
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

  const perm = await ensurePermission(ctx, userId, connectionId);
  await ctx.db.insert(auditEvents).values({
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
