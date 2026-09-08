import { and, eq } from "drizzle-orm";
import type { Hono } from "hono";
import type { Env as HonoEnv } from "../types";
import { attachments } from "../db/schema";
import { config, db, logger } from "./foundation";
import { connectors, txCoordinator } from "./policy";
import {
  agentLoop,
  executeDocsTool,
  executeTool,
  executeWebSearchToolBound,
  hub,
  makeRateLimitedClient,
  providerSettings,
  type FallbackCandidate,
} from "./ai";
import { storage } from "./storage";
import { createChatRoutes } from "../routes/chat";
import { buildSystemInstruction } from "../agent/instructions";
import { createMockClient } from "../agent/chat-client";
import { detectContentKind } from "../services/storage";

export function mountChatRoutes(app: Hono<HonoEnv>) {
  const chatRoutes = createChatRoutes({
    db,
    logger,
    loop: agentLoop,
    hub,
    connectors,
    transactions: txCoordinator,
    getProvider: (userId, model, providerId) => providerSettings.resolveForRun(userId, { model, providerId }),
    getFallbackCandidates: (userId, model, providerId) =>
      providerSettings.listFallbackCandidates(userId, { model, providerId }) as Promise<FallbackCandidate[]>,
    makeClient: (cfg, fallbackCandidates, runContext) => makeRateLimitedClient(cfg, fallbackCandidates ?? [], runContext),
    makeMockClient: () => createMockClient(),
    executeTool,
    executeDocsTool,
    executeWebSearchTool: executeWebSearchToolBound,
    buildInstruction: buildSystemInstruction,
    loadAttachmentContent: async (input) => {
      if (!storage) return null;
      const [row] = await db
        .select()
        .from(attachments)
        .where(and(eq(attachments.id, input.attachmentId), eq(attachments.userId, input.userId)))
        .limit(1);
      if (!row || row.status !== "ready") return null;
      try {
        const obj = await storage.get(row.objectKey);
        const sniff = detectContentKind({ mimeType: row.contentType, originalName: row.originalName, head: obj.body.subarray(0, 512) });
        return { kind: sniff.ok ? sniff.kind : "unsupported", name: row.originalName, mime: row.contentType, bytes: obj.body };
      } catch {
        return null;
      }
    },
    removeAttachmentObject: async (input) => {
      if (!storage) return;
      // object keys are server-generated under attachments/{userId}/ — the
      // userId scoping here is defense-in-depth against a forged key
      if (!input.objectKey.startsWith(`attachments/${input.userId}/`)) return;
      await storage.remove(input.objectKey);
    },
    limits: {
      maxSteps: config.AGENT_MAX_STEPS,
      maxToolCalls: config.AGENT_MAX_TOOL_CALLS,
      runTimeoutMs: config.AGENT_RUN_TIMEOUT_MS,
      maxTokens: 16_384,
    },
    runRateLimit: { maxRuns: 20, windowMs: 60_000 },
  });
  app.route("/", chatRoutes);
}
