import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import type { Env } from "../types";
import type { Database } from "../db";
import { AppError } from "../lib/errors";
import { requireWorkspace } from "../middleware/session";
import { conversations } from "../db/schema";
import { listActivities } from "../services/activity";

export function createActivityRoutes(deps: { db: Database }) {
  const routes = new Hono<Env>();
  routes.get("/api/conversations/:id/activities", async (c) => {
    const ws = requireWorkspace(c);
    const [conv] = await deps.db
      .select({ id: conversations.id })
      .from(conversations)
      .where(and(eq(conversations.id, c.req.param("id")), eq(conversations.userId, ws.userId)))
      .limit(1);
    if (!conv) throw new AppError("NOT_FOUND", "Percakapan tidak ditemukan.", 404);
    const url = new URL(c.req.url);
    const cursor = Number(url.searchParams.get("cursor") ?? 0) || 0;
    const limit = Math.min(Number(url.searchParams.get("limit") ?? 50) || 50, 200);
    const type = url.searchParams.get("type") ?? undefined;
    const res = await listActivities(deps.db, conv.id, { cursor, limit, type });
    return c.json(res);
  });
  return routes;
}
