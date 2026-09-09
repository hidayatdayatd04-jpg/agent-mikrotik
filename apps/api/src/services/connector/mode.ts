import { and, eq } from "drizzle-orm";
import { connectionPermissions, auditEvents } from "../../db/schema";
import { AppError } from "../../lib/errors";
import type { RouterMode } from "@shared/index";
import { toDTO } from "./dto";
import { requireOwned } from "./ownership";
import { ensurePermission } from "./ownership";
import type { ConnectorCtx } from "./types";

export async function setConnectorMode(
  ctx: ConnectorCtx,
  userId: string,
  connectionId: string,
  mode: RouterMode,
  expectedVersion: number,
): Promise<{ connector: ReturnType<typeof toDTO>; version: number }> {
  const current = await requireOwned(ctx, userId, connectionId)();
  if (mode === "write") {
    if (current.status !== "connected") {
      throw new AppError("CONFLICT", "Sambungkan router dan pastikan terverifikasi sebelum mengaktifkan mode Write.", 409);
    }
    if (!current.routerIdentity) {
      throw new AppError("CONFLICT", "Identitas router belum terverifikasi; sambungkan ulang connector lalu aktifkan Write.", 409);
    }
  }
  // compare-and-set on version
  const updated = await ctx.db
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
  const row = await requireOwned(ctx, userId, connectionId)();
  await ctx.db.insert(auditEvents).values({
    userId,
    action: mode === "write" ? "connector.write_enabled" : "connector.write_disabled",
    connectionId,
  });
  return {
    connector: toDTO(row, mode, expectedVersion + 1),
    version: expectedVersion + 1,
  };
}

export async function getConnectorMode(ctx: ConnectorCtx, userId: string, connectionId: string): Promise<{ mode: RouterMode; version: number }> {
  await requireOwned(ctx, userId, connectionId)();
  const perm = await ensurePermission(ctx, userId, connectionId);
  return { mode: perm.writeEnabled ? "write" : "read-only", version: perm.version };
}
