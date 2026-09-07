import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { and, desc, eq } from "drizzle-orm";
import type { Env } from "../types";
import type { Database } from "../db";
import type { Logger } from "../lib/logger";
import { AppError } from "../lib/errors";
import { requireWorkspace } from "../middleware/session";
import { compactionJobs, conversations, conversationSummaries } from "../db/schema";
import { latestSummary, startCompaction } from "../agent/compaction";
import type { ChatClient } from "../agent/chat-client";

export function createCompactionRoutes(deps: {
  db: Database;
  logger: Logger;
  getProviderClient: (userId: string) => Promise<{ client: ChatClient; model: string; provider: string } | null>;
}) {
  const routes = new Hono<Env>();

  async function requireOwned(userId: string, conversationId: string) {
    const [conv] = await deps.db
      .select()
      .from(conversations)
      .where(and(eq(conversations.id, conversationId), eq(conversations.userId, userId)))
      .limit(1);
    if (!conv) throw new AppError("NOT_FOUND", "Percakapan tidak ditemukan.", 404);
    return conv;
  }

  const StartSchema = z.object({ reason: z.enum(["manual", "auto"]).default("manual") });

  routes.post("/api/conversations/:id/compact", zValidator("json", StartSchema), async (c) => {
    const ws = requireWorkspace(c);
    const conv = await requireOwned(ws.userId, c.req.param("id"));
    // Refuse while a run is active on this conversation.
    const { agentRuns } = await import("../db/schema");
    const active = await deps.db
      .select({ id: agentRuns.id })
      .from(agentRuns)
      .where(and(eq(agentRuns.conversationId, conv.id), eq(agentRuns.status, "running")))
      .limit(1);
    if (active.length > 0) throw new AppError("RUN_ALREADY_ACTIVE", "Ada run aktif; tunggu atau batalkan dulu.", 409);
    const input = c.req.valid("json");
    const res = await startCompaction(
      { db: deps.db, logger: deps.logger, getProvider: async (userId) => deps.getProviderClient(userId) as never },
      { userId: ws.userId, conversationId: conv.id, reason: input.reason },
    );
    return c.json(res, 201);
  });

  routes.get("/api/conversations/:id/compaction", async (c) => {
    const ws = requireWorkspace(c);
    const conv = await requireOwned(ws.userId, c.req.param("id"));
    const summary = await latestSummary(deps.db, conv.id);
    const jobs = await deps.db
      .select()
      .from(compactionJobs)
      .where(eq(compactionJobs.conversationId, conv.id))
      .orderBy(desc(compactionJobs.createdAt))
      .limit(5);
    return c.json({
      summary: summary
        ? {
            version: summary.version,
            throughSeq: summary.throughSeq,
            model: summary.model,
            tokenBefore: summary.tokenBefore,
            tokenAfter: summary.tokenAfter,
            createdAt: (summary.createdAt as Date).toISOString(),
          }
        : null,
      jobs: jobs.map((j) => ({
        id: j.id,
        status: j.status,
        reason: j.reason,
        summaryVersion: j.summaryVersion,
        error: j.error,
        createdAt: (j.createdAt as Date).toISOString(),
        updatedAt: (j.updatedAt as Date).toISOString(),
      })),
    });
  });

  routes.get("/api/conversations/:id/summary", async (c) => {
    const ws = requireWorkspace(c);
    const conv = await requireOwned(ws.userId, c.req.param("id"));
    const rows = await deps.db
      .select()
      .from(conversationSummaries)
      .where(eq(conversationSummaries.conversationId, conv.id))
      .orderBy(desc(conversationSummaries.version))
      .limit(1);
    const s = rows[0];
    if (!s) return c.json({ summary: null });
    return c.json({
      summary: {
        version: s.version,
        throughSeq: s.throughSeq,
        summary: s.summary,
        model: s.model,
        createdAt: (s.createdAt as Date).toISOString(),
      },
    });
  });

  return routes;
}
