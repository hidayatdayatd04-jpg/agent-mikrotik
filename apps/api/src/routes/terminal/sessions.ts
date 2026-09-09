import type { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { desc, eq } from "drizzle-orm";
import { AppError } from "../../lib/errors";
import type { Env } from "../../types";
import { terminalCommands, terminalSessions } from "../../db/schema";
import { requireWorkspace } from "../../middleware/session";
import { openTerminalSession } from "../../services/terminal";
import { buildTerminalDeps, OpenSchema, type TerminalRouteDeps } from "./deps";

/** Sesi terminal: buka, daftar, tutup. */
export function registerSessionRoutes(
  routes: Hono<Env>,
  deps: TerminalRouteDeps,
  tdeps: ReturnType<typeof buildTerminalDeps>,
) {
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

  routes.delete("/sessions/:id", async (c) => {
    const ws = requireWorkspace(c);
    const [sess] = await deps.db.select().from(terminalSessions).where(eq(terminalSessions.id, c.req.param("id"))).limit(1);
    if (!sess || sess.userId !== ws.userId) throw new AppError("NOT_FOUND", "Sesi terminal tidak ditemukan.", 404);
    const running = await deps.db
      .select({ id: terminalCommands.id })
      .from(terminalCommands)
      .where(eq(terminalCommands.sessionId, sess.id));
    const active = running.length > 0 ? await deps.db.select().from(terminalCommands).where(eq(terminalCommands.sessionId, sess.id)).limit(100) : [];
    if (active.some((r) => r.status === "running" || r.status === "queued")) {
      throw new AppError("CONFLICT", "Ada command aktif; batalkan dulu sebelum menutup sesi.", 409);
    }
    await deps.db.update(terminalSessions).set({ status: "closed", closedAt: new Date() }).where(eq(terminalSessions.id, sess.id));
    return c.json({ ok: true });
  });
}
