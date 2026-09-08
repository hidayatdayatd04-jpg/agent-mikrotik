import type { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { and, desc, eq } from "drizzle-orm";
import { AppError } from "../../lib/errors";
import type { Env } from "../../types";
import { agentRuns, conversations } from "../../db/schema";
import { requireConversation, requireWorkspace, toConversationDTO } from "./helpers";
import { CreateSchema, PatchSchema, type ChatCtx } from "./types";

/** CRUD percakapan: list, buat, ambil, ubah. */
export function registerConversationRoutes(routes: Hono<Env>, ctx: ChatCtx) {
  const { deps } = ctx;

  routes.get("/api/conversations", async (c) => {
    const workspace = requireWorkspace(c);
    const url = new URL(c.req.url);
    const archivedParam = url.searchParams.get("archived");
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 50) || 50, 1), 100);
    const cursor = url.searchParams.get("cursor");
    const search = (url.searchParams.get("search") ?? "").trim().toLowerCase();
    const rows = await deps.db
      .select()
      .from(conversations)
      .where(eq(conversations.userId, workspace.userId))
      .orderBy(desc(conversations.updatedAt))
      .limit(500);
    let filtered = rows;
    if (archivedParam === "true") filtered = filtered.filter((r) => r.archivedAt);
    else if (archivedParam === "false" || archivedParam === null) filtered = filtered.filter((r) => !r.archivedAt);
    // archived=all => no filter
    if (archivedParam === "all") filtered = rows;
    if (search) filtered = filtered.filter((r) => r.title.toLowerCase().includes(search));
    // Deterministic order: pinned first by pinnedAt desc, then updatedAt desc, id tie-breaker.
    filtered.sort((a, b) => {
      const ap = a.pinnedAt ? (a.pinnedAt as Date).getTime() : 0;
      const bp = b.pinnedAt ? (b.pinnedAt as Date).getTime() : 0;
      if (!!ap !== !!bp) return ap ? -1 : 1;
      if (ap && bp && ap !== bp) return bp - ap;
      const au = (a.updatedAt as Date).getTime();
      const bu = (b.updatedAt as Date).getTime();
      if (au !== bu) return bu - au;
      return a.id.localeCompare(b.id);
    });
    let start = 0;
    if (cursor) {
      try {
        const decoded = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as { id: string };
        const idx = filtered.findIndex((r) => r.id === decoded.id);
        if (idx >= 0) start = idx + 1;
      } catch {
        /* ignore bad cursor */
      }
    }
    const page = filtered.slice(start, start + limit);
    const nextCursor =
      start + limit < filtered.length
        ? Buffer.from(JSON.stringify({ id: page[page.length - 1]!.id })).toString("base64url")
        : null;
    return c.json({ conversations: page.map(toConversationDTO), nextCursor });
  });

  routes.post("/api/conversations", zValidator("json", CreateSchema), async (c) => {
    const workspace = requireWorkspace(c);
    const input = c.req.valid("json");
    if (input.connectionId) {
      await deps.connectors.requireOwned(workspace.userId, input.connectionId)();
    }
    const title = (input.title ?? "Percakapan baru").trim() || "Percakapan baru";
    if (!title || title.length > 200) throw new AppError("VALIDATION_FAILED", "Judul 1-200 karakter.", 422);
    const [row] = await deps.db
      .insert(conversations)
      .values({
        userId: workspace.userId,
        title,
        activeConnectionId: input.connectionId ?? null,
      })
      .returning();
    return c.json({ conversation: toConversationDTO(row!) }, 201);
  });

  routes.get("/api/conversations/:id", async (c) => {
    const workspace = requireWorkspace(c);
    const conv = await requireConversation(ctx, workspace.userId, c.req.param("id"));
    return c.json({ conversation: toConversationDTO(conv) });
  });

  routes.patch("/api/conversations/:id", zValidator("json", PatchSchema), async (c) => {
    const workspace = requireWorkspace(c);
    const conv = await requireConversation(ctx, workspace.userId, c.req.param("id"));
    const input = c.req.valid("json");
    if (input.connectionId) {
      // must own the new connection too; null binding stays internal (no "tanpa router" option in UI)
      await deps.connectors.requireOwned(workspace.userId, input.connectionId)();
    }
    if (input.expectedRevision !== undefined && (conv as { revision?: number }).revision !== input.expectedRevision) {
      throw new AppError("CONFLICT", "Revisi percakapan berubah di sesi lain. Muat ulang dulu.", 409);
    }
    if (input.title !== undefined) {
      const t = input.title.trim();
      if (!t || t.length > 200) throw new AppError("VALIDATION_FAILED", "Judul 1-200 karakter, tanpa whitespace murni.", 422);
    }
    // Refuse archive/delete-target while run or terminal active.
    if (input.archived === true) {
      const active = await deps.db
        .select({ id: agentRuns.id })
        .from(agentRuns)
        .where(and(eq(agentRuns.conversationId, conv.id), eq(agentRuns.status, "running")))
        .limit(1);
      if (active.length > 0) throw new AppError("RUN_ALREADY_ACTIVE", "Ada run aktif; hentikan dulu sebelum mengarsipkan.", 409);
    }
    const now = new Date();
    const [row] = await deps.db
      .update(conversations)
      .set({
        ...(input.title !== undefined ? { title: input.title.trim() } : {}),
        ...(input.connectionId !== undefined ? { activeConnectionId: input.connectionId } : {}),
        ...(input.pinned !== undefined ? { pinnedAt: input.pinned ? now : null } : {}),
        ...(input.archived !== undefined ? { archivedAt: input.archived ? now : null } : {}),
        revision: ((conv as { revision?: number }).revision ?? 1) + 1,
        updatedAt: now,
      })
      .where(eq(conversations.id, conv.id))
      .returning();
    return c.json({ conversation: toConversationDTO(row!) });
  });
}
