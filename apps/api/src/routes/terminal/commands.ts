import type { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { desc, eq } from "drizzle-orm";
import { AppError } from "../../lib/errors";
import type { Env } from "../../types";
import { terminalCommands, terminalSessions } from "../../db/schema";
import { requireWorkspace } from "../../middleware/session";
import { submitTerminalCommand } from "../../services/terminal";
import { buildTerminalDeps, CommandSchema, type TerminalRouteDeps } from "./deps";

/** Command terminal: submit, daftar, detail, batal. */
export function registerCommandRoutes(
  routes: Hono<Env>,
  deps: TerminalRouteDeps,
  tdeps: ReturnType<typeof buildTerminalDeps>,
) {
  routes.post("/sessions/:id/commands", zValidator("json", CommandSchema), async (c) => {
    const ws = requireWorkspace(c);
    const input = c.req.valid("json");
    const res = await submitTerminalCommand(tdeps, {
      userId: ws.userId,
      sessionId: c.req.param("id"),
      command: input.command,
      conversationId: input.conversationId ?? null,
    });
    return c.json(res, 201);
  });

  routes.get("/sessions/:id/commands", async (c) => {
    const ws = requireWorkspace(c);
    const [sess] = await deps.db.select().from(terminalSessions).where(eq(terminalSessions.id, c.req.param("id"))).limit(1);
    if (!sess || sess.userId !== ws.userId) throw new AppError("NOT_FOUND", "Sesi terminal tidak ditemukan.", 404);
    const rows = await deps.db
      .select()
      .from(terminalCommands)
      .where(eq(terminalCommands.sessionId, sess.id))
      .orderBy(desc(terminalCommands.createdAt))
      .limit(50);
    return c.json({
      commands: rows.map((r) => ({
        id: r.id,
        sessionId: r.sessionId,
        command: r.command,
        status: r.status,
        exitCode: r.exitCode,
        transactionId: r.transactionId,
        durationMs: r.durationMs,
        outputPreview: r.outputPreview,
        truncated: !!r.truncated,
        errorCode: r.errorCode,
        createdAt: (r.createdAt as Date).toISOString(),
        endedAt: r.endedAt ? (r.endedAt as Date).toISOString() : null,
      })),
    });
  });

  routes.get("/commands/:id", async (c) => {
    const ws = requireWorkspace(c);
    const [cmd] = await deps.db.select().from(terminalCommands).where(eq(terminalCommands.id, c.req.param("id"))).limit(1);
    if (!cmd) throw new AppError("NOT_FOUND", "Command tidak ditemukan.", 404);
    const [sess] = await deps.db.select().from(terminalSessions).where(eq(terminalSessions.id, cmd.sessionId)).limit(1);
    if (!sess || sess.userId !== ws.userId) throw new AppError("NOT_FOUND", "Command tidak ditemukan.", 404);
    return c.json({
      command: {
        id: cmd.id,
        sessionId: cmd.sessionId,
        command: cmd.command,
        status: cmd.status,
        exitCode: cmd.exitCode,
        transactionId: cmd.transactionId,
        durationMs: cmd.durationMs,
        outputPreview: cmd.outputPreview,
        truncated: !!cmd.truncated,
        errorCode: cmd.errorCode,
        createdAt: (cmd.createdAt as Date).toISOString(),
        endedAt: cmd.endedAt ? (cmd.endedAt as Date).toISOString() : null,
      },
    });
  });

  routes.post("/commands/:id/cancel", async (c) => {
    const ws = requireWorkspace(c);
    const [cmd] = await deps.db.select().from(terminalCommands).where(eq(terminalCommands.id, c.req.param("id"))).limit(1);
    if (!cmd) throw new AppError("NOT_FOUND", "Command tidak ditemukan.", 404);
    const [sess] = await deps.db.select().from(terminalSessions).where(eq(terminalSessions.id, cmd.sessionId)).limit(1);
    if (!sess || sess.userId !== ws.userId) throw new AppError("NOT_FOUND", "Command tidak ditemukan.", 404);
    if (cmd.status === "completed" || cmd.status === "failed" || cmd.status === "cancelled" || cmd.status === "rejected") {
      return c.json({ ok: true, status: cmd.status });
    }
    // Best-effort: SSH exec tidak mendukung interrupt mid-command; tandai cancel-requested
    // dan reconcile transaksi bila ada. Tidak mengklaim rollback sukses tanpa bukti.
    await deps.db.update(terminalCommands).set({ status: "cancelled", endedAt: new Date() }).where(eq(terminalCommands.id, cmd.id));
    if (cmd.transactionId) {
      try {
        await deps.transactions.rollback(cmd.transactionId, ws.userId, { reason: "dibatalkan pengguna" });
      } catch (err) {
        deps.logger.warn("terminal cancel rollback failed", { commandId: cmd.id, error: err instanceof Error ? err.message : String(err) });
      }
    }
    return c.json({ ok: true, status: "cancelled" });
  });
}
