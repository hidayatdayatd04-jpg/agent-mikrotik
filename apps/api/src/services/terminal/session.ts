import { and, eq } from "drizzle-orm";
import { routerConnections, terminalSessions } from "../../db/schema";
import { AppError } from "../../lib/errors";
import type { TerminalDeps } from "./types";

export async function openTerminalSession(
  deps: TerminalDeps,
  input: { userId: string; connectionId: string; conversationId?: string | null; actor?: "user" | "ai" },
) {
  const [conn] = await deps.db
    .select()
    .from(routerConnections)
    .where(and(eq(routerConnections.id, input.connectionId), eq(routerConnections.userId, input.userId)))
    .limit(1);
  if (!conn) throw new AppError("NOT_FOUND", "Connector tidak ditemukan.", 404);
  if (conn.status !== "connected") throw new AppError("CONFLICT", "Connector belum terhubung (SSH). Discovery/Winbox bukan bukti SSH aktif.", 409);
  const [row] = await deps.db
    .insert(terminalSessions)
    .values({
      userId: input.userId,
      connectionId: input.connectionId,
      conversationId: input.conversationId ?? null,
      actor: input.actor ?? "user",
      status: "open",
    })
    .returning();
  return row!;
}
