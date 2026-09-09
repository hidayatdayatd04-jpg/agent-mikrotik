import { and, eq } from "drizzle-orm";
import { routerConnections, connectionPermissions } from "../../db/schema";
import { AppError } from "../../lib/errors";
import type { ConnectorCtx } from "./types";

export function requireOwned(ctx: ConnectorCtx, userId: string, connectionId: string) {
  return async () => {
    const [conn] = await ctx.db
      .select()
      .from(routerConnections)
      .where(and(eq(routerConnections.id, connectionId), eq(routerConnections.userId, userId)))
      .limit(1);
    if (!conn) throw new AppError("NOT_FOUND", "Connector tidak ditemukan.", 404);
    return conn;
  };
}

export async function ensurePermission(ctx: ConnectorCtx, userId: string, connectionId: string) {
  const [perm] = await ctx.db
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
    await ctx.db
      .insert(connectionPermissions)
      .values({ userId, connectionId, writeEnabled: false })
      .onConflictDoNothing();
    return { writeEnabled: false, version: 1 };
  }
  return { writeEnabled: perm.writeEnabled, version: perm.version };
}
