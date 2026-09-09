import { and, eq } from "drizzle-orm";
import { routerConnections, terminalCommands, terminalSessions } from "../../db/schema";
import { AppError } from "../../lib/errors";
import { classifyBatch, isLocalCommand, type ClassifiedCommand } from "../terminal-classifier";
import { recordActivity } from "../activity";
import { routerKeyFor, tryAcquireRouter } from "./locks";
import type { TerminalDeps } from "./types";

export interface QueuedTerminalCommand {
  sess: { id: string; connectionId: string; userId: string; conversationId: string | null };
  conn: { host: string; port: number; username: string; routerIdentity: string | null };
  cmdRowId: string;
  raw: string;
  commands: ClassifiedCommand[];
  overall: "read" | "write" | "unknown";
  key: string;
  owner: string;
}

/** Validasi + klasifikasi + persist antrean; lempar typed error bila ditolak. */
export async function queueTerminalCommand(
  deps: TerminalDeps,
  input: { userId: string; sessionId: string; command: string; conversationId?: string | null },
): Promise<QueuedTerminalCommand> {
  const raw = input.command.slice(0, 4000);
  if (!raw.trim()) throw new AppError("VALIDATION_FAILED", "Perintah kosong.", 422);
  if (isLocalCommand(raw)) {
    throw new AppError("VALIDATION_FAILED", "Perintah lokal terminal (clear/help) — jalankan di frontend saja.", 422);
  }
  const [sess] = await deps.db.select().from(terminalSessions).where(eq(terminalSessions.id, input.sessionId)).limit(1);
  if (!sess || sess.userId !== input.userId) throw new AppError("NOT_FOUND", "Sesi terminal tidak ditemukan.", 404);
  if (sess.status !== "open") throw new AppError("CONFLICT", "Sesi terminal sudah ditutup.", 409);

  const [conn] = await deps.db
    .select()
    .from(routerConnections)
    .where(and(eq(routerConnections.id, sess.connectionId), eq(routerConnections.userId, input.userId)))
    .limit(1);
  if (!conn) throw new AppError("NOT_FOUND", "Connector tidak ditemukan.", 404);
  if (conn.status !== "connected") throw new AppError("CONFLICT", "Router terputus; reconnect dahulu. Output sebelumnya tidak diulang.", 409);

  const { commands, overall, blocked } = classifyBatch(raw);
  const [cmdRow] = await deps.db
    .insert(terminalCommands)
    .values({ sessionId: sess.id, command: raw, status: blocked ? "rejected" : "queued" })
    .returning();
  if (blocked) {
    await deps.db.update(terminalCommands).set({ status: "rejected", errorCode: "VALIDATION_FAILED", endedAt: new Date(), outputPreview: blocked.slice(0, 2000) }).where(eq(terminalCommands.id, cmdRow!.id));
    if (input.conversationId ?? sess.conversationId) {
      await recordActivity(deps.db, {
        conversationId: (input.conversationId ?? sess.conversationId)!,
        type: "terminal.rejected",
        actor: "user",
        activityId: `term-${cmdRow!.id}`,
        payload: { command: raw.slice(0, 500), reason: blocked },
      });
    }
    throw new AppError("VALIDATION_FAILED", blocked, 422);
  }

  const { mode } = await deps.getMode(input.userId, sess.connectionId);
  if (overall === "write" && mode !== "write") {
    await deps.db.update(terminalCommands).set({ status: "rejected", errorCode: "WRITE_DISABLED", endedAt: new Date(), outputPreview: "Mode Read-Only: mutasi ditolak." }).where(eq(terminalCommands.id, cmdRow!.id));
    throw new AppError("WRITE_DISABLED", "Mode Read-Only aktif. Ubah izin via composer untuk mutasi.", 403);
  }

  const key = routerKeyFor(conn.host, conn.port, conn.username);
  const owner = `term:${cmdRow!.id}`;
  if (!tryAcquireRouter(key, owner)) {
    await deps.db.update(terminalCommands).set({ status: "rejected", errorCode: "CONFLICT", endedAt: new Date(), outputPreview: "Router sedang digunakan" }).where(eq(terminalCommands.id, cmdRow!.id));
    throw new AppError("CONFLICT", "Router sedang digunakan run/sesi lain. Tunggu hingga selesai.", 409);
  }

  return {
    sess: { id: sess.id, connectionId: sess.connectionId, userId: sess.userId, conversationId: sess.conversationId },
    conn: { host: conn.host, port: conn.port, username: conn.username, routerIdentity: conn.routerIdentity },
    cmdRowId: cmdRow!.id,
    raw,
    commands,
    overall,
    key,
    owner,
  };
}
