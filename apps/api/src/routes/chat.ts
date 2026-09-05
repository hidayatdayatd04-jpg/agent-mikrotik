import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { and, asc, desc, eq } from "drizzle-orm";
import type { Env } from "../types";
import type { Database } from "../db";
import { AppError } from "../lib/errors";
import { conversations, messages, agentRuns } from "../db/schema";
import type { Logger } from "../lib/logger";
import type { SessionContext } from "../services/auth";
import type { AgentLoop, RunEvent } from "../agent/loop";
import type { RunEventHub } from "../agent/hub";
import type { ConnectorService } from "../services/connector";
import type { ChatClient } from "../agent/chat-client";
import type { ProviderConfigWithKey } from "../agent/provider-settings";
import { buildSystemInstruction } from "../agent/instructions";

/**
 * Conversations + runs (M7). Runs execute in the background (agent loop) and
 * publish events to the hub; browsers attach via SSE. The start endpoint is
 * idempotent per (conversationId, idempotencyKey).
 */
export function createChatRoutes(deps: {
  db: Database;
  logger: Logger;
  loop: AgentLoop;
  hub: RunEventHub;
  connectors: ConnectorService;
  /** Returns the user's decrypted provider config (or null when unconfigured). */
  getProvider: (userId: string) => Promise<ProviderConfigWithKey | null>;
  /** Builds a real OpenAI-compatible client from a stored config. */
  makeClient: (cfg: ProviderConfigWithKey) => ChatClient;
  /** Deterministic mock client for unconfigured users. */
  makeMockClient: () => ChatClient;
  /** Executes a dispatched tool on the user's child. */
  executeTool: (input: { userId: string; connectionId: string; fqName: string; args: unknown }) => Promise<{ ok: boolean; output: string; errorCode?: string }>;
  /** Executes documentation tools via the shared Rosetta process (no router). */
  executeDocsTool: (input: { fqName: string; args: unknown }) => Promise<{ ok: boolean; output: string; errorCode?: string }>;
  /** Builds the system instruction for a run. */
  buildInstruction: typeof buildSystemInstruction;
  limits: { maxSteps: number; maxToolCalls: number; runTimeoutMs: number; maxTokens: number };
}) {
  const routes = new Hono<Env>();

  const CreateSchema = z.object({
    title: z.string().min(1).max(200).optional(),
    connectionId: z.string().uuid().nullable().optional(),
  });

  const PatchSchema = z.object({
    title: z.string().min(1).max(200).optional(),
    connectionId: z.string().uuid().nullable().optional(),
  });

  const RunSchema = z.object({
    text: z.string().min(1).max(16_000),
    idempotencyKey: z.string().min(8).max(128),
  });

  async function requireConversation(userId: string, conversationId: string) {
    const [conv] = await deps.db
      .select()
      .from(conversations)
      .where(and(eq(conversations.id, conversationId), eq(conversations.userId, userId)))
      .limit(1);
    if (!conv) throw new AppError("NOT_FOUND", "Percakapan tidak ditemukan.", 404);
    return conv;
  }

  routes.get("/api/conversations", async (c) => {
    const session = requireSession(c);
    const rows = await deps.db
      .select()
      .from(conversations)
      .where(eq(conversations.userId, session.userId))
      .orderBy(desc(conversations.updatedAt))
      .limit(100);
    return c.json({ conversations: rows.map((r) => ({ id: r.id, title: r.title, activeConnectionId: r.activeConnectionId, updatedAt: r.updatedAt })) });
  });

  routes.post("/api/conversations", zValidator("json", CreateSchema), async (c) => {
    const session = requireSession(c);
    const input = c.req.valid("json");
    const [row] = await deps.db
      .insert(conversations)
      .values({
        userId: session.userId,
        title: input.title ?? "Percakapan baru",
        activeConnectionId: input.connectionId ?? null,
      })
      .returning();
    return c.json({ conversation: { id: row!.id, title: row!.title, activeConnectionId: row!.activeConnectionId } }, 201);
  });

  routes.patch("/api/conversations/:id", zValidator("json", PatchSchema), async (c) => {
    const session = requireSession(c);
    const conv = await requireConversation(session.userId, c.req.param("id"));
    const input = c.req.valid("json");
    if (input.connectionId) {
      // must own the new connection too
      await deps.connectors.requireOwned(session.userId, input.connectionId)();
    }
    const [row] = await deps.db
      .update(conversations)
      .set({
        ...(input.title ? { title: input.title } : {}),
        ...(input.connectionId !== undefined ? { activeConnectionId: input.connectionId } : {}),
        updatedAt: new Date(),
      })
      .where(eq(conversations.id, conv.id))
      .returning();
    return c.json({ conversation: { id: row!.id, title: row!.title, activeConnectionId: row!.activeConnectionId } });
  });

  routes.delete("/api/conversations/:id", async (c) => {
    const session = requireSession(c);
    const conv = await requireConversation(session.userId, c.req.param("id"));
    // refuse deletion while a run is active on this conversation
    const active = await deps.db
      .select({ id: agentRuns.id })
      .from(agentRuns)
      .where(and(eq(agentRuns.conversationId, conv.id), eq(agentRuns.status, "running")))
      .limit(1);
    if (active.length > 0) {
      throw new AppError("RUN_ALREADY_ACTIVE", "Ada run aktif pada percakapan ini; batalkan dulu.", 409);
    }
    await deps.db.delete(conversations).where(eq(conversations.id, conv.id));
    return c.json({ ok: true });
  });

  routes.get("/api/conversations/:id/messages", async (c) => {
    const session = requireSession(c);
    const conv = await requireConversation(session.userId, c.req.param("id"));
    const rows = await deps.db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conv.id))
      .orderBy(asc(messages.seq))
      .limit(500);
    return c.json({
      messages: rows.map((r) => ({ id: r.id, role: r.role, content: r.content, status: r.status, seq: r.seq, createdAt: r.createdAt })),
    });
  });

  routes.post("/api/conversations/:id/runs", zValidator("json", RunSchema), async (c) => {
    const session = requireSession(c);
    const conv = await requireConversation(session.userId, c.req.param("id"));
    const input = c.req.valid("json");

    // idempotency: same conversation + key returns the existing run
    const [existing] = await deps.db
      .select()
      .from(agentRuns)
      .where(and(eq(agentRuns.conversationId, conv.id), eq(agentRuns.idempotencyKey, input.idempotencyKey)))
      .limit(1);
    if (existing) {
      return c.json({ runId: existing.id, status: existing.status, resumed: true });
    }

    // one active run per conversation
    const active = await deps.db
      .select({ id: agentRuns.id })
      .from(agentRuns)
      .where(and(eq(agentRuns.conversationId, conv.id), eq(agentRuns.status, "running")))
      .limit(1);
    if (active.length > 0) {
      throw new AppError("RUN_ALREADY_ACTIVE", "Satu run aktif per percakapan. Tunggu atau batalkan run berjalan.", 409);
    }

    // policy snapshot from the live mode of the active connection
    const connectionId = conv.activeConnectionId;
    let mode: "read-only" | "write" = "read-only";
    let modeVersion = connectionId ? 1 : 0; // 0 = no-router run pinned read-only
    if (connectionId) {
      const live = await deps.connectors.getMode(session.userId, connectionId);
      mode = live.mode;
      modeVersion = live.version;
    }

    // persist input BEFORE streaming starts
    const all = await deps.db
      .select({ seq: messages.seq })
      .from(messages)
      .where(eq(messages.conversationId, conv.id));
    const maxSeq = all.reduce((m, r) => Math.max(m, r.seq), 0);
    const [userMsg] = await deps.db
      .insert(messages)
      .values({ conversationId: conv.id, role: "user", content: { text: input.text }, seq: maxSeq + 1 })
      .returning();
    const [run] = await deps.db
      .insert(agentRuns)
      .values({
        userId: session.userId,
        conversationId: conv.id,
        connectionId: connectionId ?? null,
        idempotencyKey: input.idempotencyKey,
        status: "queued",
      })
      .returning();

    // background execution — the response returns immediately with runId
    void (async () => {
      try {
        // per-run provider client (real provider bila dikonfigurasi; mock bila belum)
        const cfg = await deps.getProvider(session.userId);
        const client = cfg ? deps.makeClient(cfg) : deps.makeMockClient();
        // system instruction reflects the live router + mode of THIS run
        let routerLabel: string | null = null;
        if (connectionId) {
          try {
            const conn = await deps.connectors.requireOwned(session.userId, connectionId)();
            routerLabel = conn.routerIdentity ?? conn.host;
          } catch {
            routerLabel = null;
          }
        }
        await deps.loop.run(
          {
            runId: run!.id,
            userId: session.userId,
            conversationId: conv.id,
            connectionId: connectionId ?? null,
            userMessageId: userMsg!.id,
            userText: input.text,
            policy: { userId: session.userId, connectionId: connectionId ?? "none", mode, modeVersion, transactionState: "none" },
            client,
            executeTool: (call) => {
              if (call.fqName.startsWith("docs:")) {
                return deps.executeDocsTool({ fqName: call.fqName, args: call.args });
              }
              if (connectionId && connectionId !== "none") {
                return deps.executeTool({ userId: session.userId, connectionId, fqName: call.fqName, args: call.args });
              }
              return Promise.resolve({ ok: false, output: "Tidak ada router aktif pada percakapan ini.", errorCode: "TOOL_UNSUPPORTED" });
            },
            systemInstruction: deps.buildInstruction({ mode, routerLabel, modelLabel: client.modelLabel }),
          },
          (e) => {
            deps.hub.publish(e.runId, e);
            return Promise.resolve();
          },
        );
      } catch (err) {
        deps.logger.error("background run crashed", { runId: run!.id, message: err instanceof Error ? err.message : String(err) });
      }
    })();

    return c.json({ runId: run!.id, status: run!.status }, 201);
  });

  routes.get("/api/runs/:id", async (c) => {
    const session = requireSession(c);
    const [row] = await deps.db
      .select()
      .from(agentRuns)
      .where(and(eq(agentRuns.id, c.req.param("id")), eq(agentRuns.userId, session.userId)))
      .limit(1);
    if (!row) throw new AppError("NOT_FOUND", "Run tidak ditemukan.", 404);
    const log = deps.hub.replayUpTo(row.id);
    return c.json({
      run: { id: row.id, status: row.status, conversationId: row.conversationId, usage: row.usage },
      events: log.map((e) => ({ type: e.type, seq: e.seq, payload: e.payload })),
    });
  });

  routes.post("/api/runs/:id/cancel", async (c) => {
    const session = requireSession(c);
    const [row] = await deps.db
      .select()
      .from(agentRuns)
      .where(and(eq(agentRuns.id, c.req.param("id")), eq(agentRuns.userId, session.userId)))
      .limit(1);
    if (!row) throw new AppError("NOT_FOUND", "Run tidak ditemukan.", 404);
    deps.loop.cancel(row.id);
    await deps.db.update(agentRuns).set({ cancelRequested: true }).where(eq(agentRuns.id, row.id));
    return c.json({ ok: true });
  });

  routes.get("/api/runs/:id/events", async (c) => {
    const session = requireSession(c);
    const [row] = await deps.db
      .select()
      .from(agentRuns)
      .where(and(eq(agentRuns.id, c.req.param("id")), eq(agentRuns.userId, session.userId)))
      .limit(1);
    if (!row) throw new AppError("NOT_FOUND", "Run tidak ditemukan.", 404);
    const runId = row.id;
    const fromSeq = Number(new URL(c.req.url).searchParams.get("from") ?? 0);

    // snapshot first (for reconnect), then live events
    const snapshot = deps.hub.replayUpTo(runId).filter((e) => e.seq > fromSeq);
    return new Response(
      new ReadableStream({
        start(controller) {
          const enc = new TextEncoder();
          let closed = false;
          const write = (data: string) => {
            if (!closed) controller.enqueue(enc.encode(data));
          };
          for (const ev of snapshot) {
            write(`id: ${ev.seq}\nevent: ${ev.type}\ndata: ${JSON.stringify({ runId: ev.runId, seq: ev.seq, payload: ev.payload })}\n\n`);
          }
          if (row.status === "completed" || row.status === "failed" || row.status === "cancelled") {
            // terminal state already reached; end the stream
            write(`event: done\ndata: ${JSON.stringify({ status: row.status })}\n\n`);
            closed = true;
            controller.close();
            return;
          }
          const sub = {
            id: `sub-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            send: (event: RunEvent) => {
              if (event.seq <= fromSeq) return;
              write(`id: ${event.seq}\nevent: ${event.type}\ndata: ${JSON.stringify({ runId: event.runId, seq: event.seq, payload: event.payload })}\n\n`);
              if (event.type === "run.completed" || event.type === "run.failed" || event.type === "run.cancelled") {
                write(`event: done\ndata: {}\n\n`);
                closed = true;
                controller.close();
              }
            },
          };
          deps.hub.subscribe(runId, sub, fromSeq);
          const heartbeat = setInterval(() => write(`: heartbeat\n\n`), 15_000);
          c.req.raw.signal.addEventListener("abort", () => {
            clearInterval(heartbeat);
            deps.hub.unsubscribe(runId, sub);
            closed = true;
            try {
              controller.close();
            } catch {
              /* already closed */
            }
          });
        },
      }),
      {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        },
      },
    );
  });

  function requireSession(c: { get: (k: "session") => unknown }): SessionContext {
    const s = c.get("session");
    if (!s) throw new AppError("AUTH_REQUIRED", "Silakan masuk terlebih dahulu.", 401);
    return s as SessionContext;
  }

  return routes;
}
