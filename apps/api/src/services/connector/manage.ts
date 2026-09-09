import { eq } from "drizzle-orm";
import { routerConnections, auditEvents } from "../../db/schema";
import type { ConnectorDTO } from "@shared/index";
import { toDTO } from "./dto";
import { ensurePermission, requireOwned } from "./ownership";
import type { ConnectorCtx } from "./types";

export async function listConnectors(ctx: ConnectorCtx, userId: string): Promise<ConnectorDTO[]> {
  const rows = await ctx.db
    .select()
    .from(routerConnections)
    .where(eq(routerConnections.userId, userId));
  const out: ConnectorDTO[] = [];
  for (const row of rows) {
    const perm = await ensurePermission(ctx, userId, row.id);
    out.push(toDTO(row, perm.writeEnabled ? "write" : "read-only", perm.version));
  }
  return out;
}

export async function removeConnector(ctx: ConnectorCtx, userId: string, connectionId: string): Promise<void> {
  const row = await requireOwned(ctx, userId, connectionId)();
  await ctx.db.delete(routerConnections).where(eq(routerConnections.id, connectionId));
  await ctx.db.insert(auditEvents).values({
    userId,
    action: "connector.deleted",
    connectionId,
    metadata: { host: row.host },
  });
}
