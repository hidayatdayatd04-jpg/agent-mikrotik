import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { and, desc, eq } from "drizzle-orm";
import type { Env } from "../types";
import type { Database } from "../db";
import type { Logger } from "../lib/logger";
import { AppError } from "../lib/errors";
import type { WorkspaceContext } from "../lib/workspace";
import { terminalCommands, terminalSessions } from "../db/schema";
import { openTerminalSession, submitTerminalCommand } from "../services/terminal";
import type { ConnectorService } from "../services/connector";
import type { TransactionCoordinator } from "../transactions/coordinator";

const OpenSchema = z.object({
  connectionId: z.string().uuid(),
  conversationId: z.string().uuid().nullable().optional(),
});

const CommandSchema = z.object({
  command: z.string().min(1).max(4000),
  conversationId: z.string().uuid().nullable().optional(),
});

export function createTerminalRoutes(deps: {
  db: Database;
  logger: Logger;
  connectors: ConnectorService;
  transactions: TransactionCoordinator;
}) {
  const routes = new Hono<Env>();
  function requireWorkspace(c: { get: (k: "workspace") => unknown }): WorkspaceContext {
    const s = c.get("workspace");
    if (!s) throw new AppError("UNAUTHORIZED", "Session habis atau belum login.", 401);
    return s as WorkspaceContext;
  }
  const tdeps = {
    db: deps.db,
    logger: deps.logger,
    decryptCredential: (u: string, cId: string) => deps.connectors.decryptCredential(u, cId),
    getMode: (u: string, cId: string) => deps.connectors.getMode(u, cId),
    transactions: {
      begin: deps.transactions.begin.bind(deps.transactions),
      commit: deps.transactions.commit.bind(deps.transactions),
      rollback: (txId: string, userId: string, meta: { reason: string }) =>
        deps.transactions.rollback(txId, userId, meta),
      getActionCount: (txId: string) => deps.transactions.getActionCount(txId),
    },
  };

  routes.post("/sessions", zValidator("json", OpenSchema), async (c) => {
    const ws = requireWorkspace(c);
    const input = c.req.valid("json");
    const row = await openTerminalSession(tdeps, {
      userId: ws.userId,
      connectionId: input.connectionId,
      conversationId: input.conversationId ?? null,
      actor: "user",
    });
    return c.json(
      { session: { id: row.id, status: row.status, connectionId: row.connectionId, createdAt: (row.createdAt as Date).toISOString() } },
      201,
    );
  });

  routes.get("/sessions", async (c) => {
    const ws = requireWorkspace(c);
    const url = new URL(c.req.url);
    const connectionId = url.searchParams.get("connectionId");
    const rows = await deps.db
      .select()
      .from(terminalSessions)
      .where(eq(terminalSessions.userId, ws.userId))
      .orderBy(desc(terminalSessions.createdAt))
      .limit(20);
    const filtered = connectionId ? rows.filter((r) => r.connectionId === connectionId) : rows;
    return c.json({
      sessions: filtered.map((r) => ({
        id: r.id,
        connectionId: r.connectionId,
        conversationId: r.conversationId,
        status: r.status,
        createdAt: (r.createdAt as Date).toISOString(),
      })),
    });
  });

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

  routes.delete("/sessions/:id", async (c) => {
    const ws = requireWorkspace(c);
    const [sess] = await deps.db.select().from(terminalSessions).where(eq(terminalSessions.id, c.req.param("id"))).limit(1);
    if (!sess || sess.userId !== ws.userId) throw new AppError("NOT_FOUND", "Sesi terminal tidak ditemukan.", 404);
    const running = await deps.db
      .select({ id: terminalCommands.id })
      .from(terminalCommands)
      .where(and(eq(terminalCommands.sessionId, sess.id)));
    const active = running.length > 0 ? await deps.db.select().from(terminalCommands).where(eq(terminalCommands.sessionId, sess.id)).limit(100) : [];
    if (active.some((r) => r.status === "running" || r.status === "queued")) {
      throw new AppError("CONFLICT", "Ada command aktif; batalkan dulu sebelum menutup sesi.", 409);
    }
    await deps.db.update(terminalSessions).set({ status: "closed", closedAt: new Date() }).where(eq(terminalSessions.id, sess.id));
    return c.json({ ok: true });
  });

  return routes;
}
