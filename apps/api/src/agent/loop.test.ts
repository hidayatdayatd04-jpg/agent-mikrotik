import { describe, expect, test, beforeEach } from "bun:test";
import { createAgentLoop, type RunEvent } from "./loop";
import type { ChatClient, StreamEvent, ChatToolCall } from "./chat-client";
import { agentRuns, conversations, messages, toolExecutions, workspaces, changeTransactions, routerConnections } from "../db/schema";
import { createDb, type Database } from "../db";
import { eq } from "drizzle-orm";
import type { NormalizedTool } from "../policies/normalize";
import { AppError } from "../lib/errors";
import { isGreetingOnly } from "./intent";

/**
 * Agent loop unit tests against SQLite with a scripted provider
 * client and a stub dispatcher — no real provider, no real router.
 * Turn 1: provider emits a tool call (valid JSON args).
 * Turn 2: provider sees the tool result and emits the final text.
 */
const dbUrl = ":memory:";

let db: Database;
let connected = false;

const silentLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => silentLogger,
} as unknown as Parameters<typeof createAgentLoop>[0]["logger"];

function makeCatalog(): NormalizedTool[] {
  return [
    {
      fqName: "docs:routeros_search",
      rawName: "routeros_search",
      origin: "custom",
      risk: "read",
      classificationProvenance: "custom-manifest",
      capabilities: [],
      inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
      description: "Cari dokumentasi RouterOS",
      isGateway: false,
    },
  ];
}

/** Scripted client: tool call on the first turn, final text on later turns. */
function makeScriptedClient(script: { toolCalls?: ChatToolCall[]; text: string; usage?: { promptTokens: number; completionTokens: number } }[]): ChatClient {
  let turn = 0;
  return {
    modelLabel: "scripted-test-model",
    async *stream() {
      const step = script[Math.min(turn, script.length - 1)]!;
      turn += 1;
      if (step.toolCalls) {
        yield { type: "tool_calls", toolCalls: step.toolCalls } satisfies StreamEvent;
      }
      yield { type: "text", text: step.text } satisfies StreamEvent;
      if (step.usage) yield { type: "usage", usage: step.usage } satisfies StreamEvent;
      yield { type: "done" } satisfies StreamEvent;
    },
  };
}

const stubDispatcher = {
  check: async (input: { toolFqName: string }) =>
    input.toolFqName === "docs:routeros_search"
      ? { allowed: true as const, tool: makeCatalog()[0] }
      : { allowed: false as const, code: "TOOL_NOT_FOUND", message: "tidak ada" },
};

const stubCoordinator = { recordAction: () => {}, getActionCount: () => 0 };

async function setup() {
  const [u] = await db.insert(workspaces).values({ name: "loop-test" }).returning();
  const [c] = await db.insert(conversations).values({ userId: u!.id, title: "t" }).returning();
  const [m] = await db
    .insert(messages)
    .values({ conversationId: c!.id, role: "user", content: { text: "cari safe mode" }, status: "complete", seq: 1 })
    .returning();
  const [r] = await db.insert(agentRuns).values({ conversationId: c!.id, userId: u!.id, status: "queued", policyVersion: 1 }).returning();
  return { userId: u!.id, conversationId: c!.id, userMessageId: m!.id, runId: r!.id };
}

beforeEach(async () => {
  try {
    if (!db) {
      db = createDb(dbUrl);
      await db.run("select 1");
    }
    await db.run("select 1");
    connected = true;
  } catch {
    throw new Error("SQLite test setup failed");
  }
});

describe("agent loop (unit, SQLite)", () => {
  test("greetings do not load tools or execute even an unsolicited provider tool call", async () => {
    const ctx = await setup();
    let offered = -1;
    const loop = createAgentLoop({ db, logger: silentLogger, dispatcher: stubDispatcher as never, txCoordinator: stubCoordinator as never, catalog: { getCatalog: async () => { throw new Error("greeting must not load catalog"); } }, limits: { maxSteps: 3, maxToolCalls: 3, runTimeoutMs: 10000, maxTokens: 100 } });
    const events: RunEvent[] = [];
    const result = await loop.run({ ...ctx, connectionId: null, userText: "halo", policy: { userId: ctx.userId, connectionId: "none", mode: "read-only", modeVersion: 0, transactionState: "none" }, client: {
      modelLabel: "test:greeting", async *stream(input) {
        offered = input.tools.length;
        yield { type: "text", text: "Halo!" };
        yield { type: "tool_calls", toolCalls: [{ id: "unwanted", name: "docs_routeros_search", argumentsJson: "{}" }] };
        yield { type: "done" };
      },
    }, executeTool: async () => { throw new Error("must not execute"); }, systemInstruction: "s" }, async (e) => { events.push(e); });
    expect(result.status).toBe("completed");
    expect(offered).toBe(0);
    expect(events.some((e) => e.type.startsWith("tool."))).toBe(false);
    expect(isGreetingOnly("Halo, cek router saya")).toBe(false);
    expect(isGreetingOnly("selamat pagi admin!")).toBe(true);
  });

  test("assistant timeline persists preamble, tools and final answer in order", async () => {
    const ctx = await setup();
    const loop = createAgentLoop({ db, logger: silentLogger, dispatcher: stubDispatcher as never, txCoordinator: stubCoordinator as never, catalog: { getCatalog: async () => makeCatalog() }, limits: { maxSteps: 3, maxToolCalls: 3, runTimeoutMs: 10000, maxTokens: 100 } });
    await loop.run({ ...ctx, connectionId: null, userText: "cari dokumentasi", policy: { userId: ctx.userId, connectionId: "none", mode: "read-only", modeVersion: 0, transactionState: "none" }, client: makeScriptedClient([
      { text: "Saya akan mencari.", toolCalls: [{ id: "c1", name: "docs_routeros_search", argumentsJson: '{"query":"safe mode"}' }] },
      { text: "Dokumentasi ditemukan." },
    ]), executeTool: async () => ({ ok: true, output: "hasil" }), systemInstruction: "s" }, async () => {});
    const rows = await db.select().from(messages).where(eq(messages.conversationId, ctx.conversationId));
    const content = rows.find((m) => m.role === "assistant")!.content as { timeline: RunEvent[] };
    expect(content.timeline.map((e) => e.type)).toEqual(["message.delta", "tool.started", "tool.completed", "message.delta"]);
    expect(content.timeline[0]!.payload.text).toBe("Saya akan mencari.");
    expect(content.timeline.at(-1)!.payload.text).toContain("Dokumentasi ditemukan.");
  });
  test("cancel aborts a waiting provider and persists partial text as cancelled", async () => {
    const ctx = await setup();
    const loop = createAgentLoop({ db, logger: silentLogger, dispatcher: stubDispatcher as never, txCoordinator: stubCoordinator as never, catalog: { getCatalog: async () => [] }, limits: { maxSteps: 3, maxToolCalls: 3, runTimeoutMs: 10000, maxTokens: 100 } });
    let aborted = false;
    let requestReady!: () => void;
    const ready = new Promise<void>((resolve) => { requestReady = resolve; });
    const events: RunEvent[] = [];
    const client: ChatClient = {
      modelLabel: "test:cancel",
      async *stream({ signal }) {
        yield { type: "text", text: "Jawaban sebagian." };
        await new Promise<void>((_, reject) => {
          signal!.addEventListener("abort", () => { aborted = true; reject(signal!.reason); }, { once: true });
          requestReady();
        });
        yield { type: "text", text: "MUST NOT APPEAR" };
      },
    };
    const pending = loop.run({ ...ctx, connectionId: null, userText: "test", policy: { userId: ctx.userId, connectionId: "none", mode: "read-only", modeVersion: 0, transactionState: "none" }, client, executeTool: async () => { throw new Error("must not execute"); }, systemInstruction: "s" }, async (event) => { events.push(event); });
    await ready;
    loop.cancel(ctx.runId);
    expect(await pending).toEqual({ status: "cancelled" });
    expect(aborted).toBe(true);
    expect(events.at(-1)?.type).toBe("run.cancelled");
    const [run] = await db.select().from(agentRuns).where(eq(agentRuns.id, ctx.runId));
    expect(run?.status).toBe("cancelled");
    const saved = await db.select().from(messages).where(eq(messages.conversationId, ctx.conversationId));
    expect(saved.find((m) => m.role === "assistant")).toMatchObject({ status: "cancelled", content: { text: "Jawaban sebagian." } });
    const maxSeq = saved.reduce((max, row) => Math.max(max, row.seq), 0);
    const [nextMessage] = await db.insert(messages).values({ conversationId: ctx.conversationId, role: "user", content: { text: "lanjut" }, seq: maxSeq + 1 }).returning();
    const [nextRun] = await db.insert(agentRuns).values({ userId: ctx.userId, conversationId: ctx.conversationId, status: "queued" }).returning();
    const result = await loop.run({ ...ctx, runId: nextRun!.id, userMessageId: nextMessage!.id, connectionId: null, userText: "lanjut", policy: { userId: ctx.userId, connectionId: "none", mode: "read-only", modeVersion: 0, transactionState: "none" }, client: makeScriptedClient([{ text: "Lanjutan." }]), executeTool: async () => { throw new Error("must not execute"); }, systemInstruction: "s" }, async () => {});
    expect(result).toEqual({ status: "completed" });
    const all = await db.select({ seq: messages.seq }).from(messages).where(eq(messages.conversationId, ctx.conversationId));
    expect(new Set(all.map(row => row.seq)).size).toBe(all.length);
    expect(all.map(row => row.seq).sort((a, b) => a - b)).toEqual([1, 2, 3, 4]);

  });

  test("provider rate limit preserves UPSTREAM_ERROR in events and persisted failure", async () => {
    const ctx = await setup();
    const loop = createAgentLoop({
      db, logger: silentLogger,
      dispatcher: stubDispatcher as never,
      txCoordinator: stubCoordinator as never,
      catalog: { getCatalog: async () => makeCatalog() },
      limits: { maxSteps: 5, maxToolCalls: 5, runTimeoutMs: 10_000, maxTokens: 1000 },
    });
    const events: RunEvent[] = [];
    const message = "Provider AI membatasi permintaan (429 / rate limit). Kuota habis, tunggu sebentar.";
    await loop.run({
      ...ctx, connectionId: null, userText: "hello",
      policy: { userId: ctx.userId, connectionId: "none", mode: "read-only", modeVersion: 0, transactionState: "none" },
      client: {
        modelLabel: "rate-limited-test",
        stream() { throw new AppError("UPSTREAM_ERROR", message, 502); },
      },
      executeTool: async () => { throw new Error("must not execute tools"); },
      systemInstruction: "s",
    }, async (event) => { events.push(event); });
    expect(events.at(-1)).toMatchObject({ type: "run.failed", payload: { code: "UPSTREAM_ERROR", message } });
    const [run] = await db.select().from(agentRuns).where(eq(agentRuns.id, ctx.runId));
    expect(run).toMatchObject({ status: "failed", usage: { error: "UPSTREAM_ERROR" } });
    const saved = await db.select().from(messages).where(eq(messages.conversationId, ctx.conversationId));
    const assistant = saved.find((m) => m.role === "assistant");
    expect(assistant?.status).toBe("failed");
    expect((assistant?.content as { text: string }).text).toContain(message);
    expect((assistant?.content as { text: string }).text).not.toContain("INTERNAL_ERROR");
  });

  test("happy path: tool call → result → final text, events in order, run completed", async () => {
    if (!connected) return;
    const ctx = await setup();
    const loop = createAgentLoop({
      db,
      logger: silentLogger,
      dispatcher: stubDispatcher as never,
      txCoordinator: stubCoordinator as never,
      catalog: { getCatalog: async () => makeCatalog() },
      limits: { maxSteps: 5, maxToolCalls: 5, runTimeoutMs: 10_000, maxTokens: 1000 },
    });
    const events: RunEvent[] = [];
    let executed: { fqName: string; args: unknown } | null = null;
    const client = makeScriptedClient([
      { toolCalls: [{ id: "call-1", name: "docs_routeros_search", argumentsJson: '{"query":"safe mode"}' }], text: "" },
      { text: "Hasil pencarian ditemukan: Configuration Management.", usage: { promptTokens: 10, completionTokens: 5 } },
    ]);
    await loop.run(
      {
        ...ctx,
        connectionId: null,
        userText: "cari safe mode",
        policy: { userId: ctx.userId, connectionId: "none", mode: "read-only", modeVersion: 0, transactionState: "none" },
        client,
        executeTool: async (input) => {
          executed = { fqName: input.fqName, args: input.args };
          return { ok: true, output: JSON.stringify({ content: [{ type: "text", text: "safe mode docs" }] }) };
        },
        systemInstruction: "instruksi sistem test",
      },
      async (e) => {
        events.push(e);
      },
    );
    const types = events.map((e) => e.type);
    expect(types[0]).toBe("run.started");
    expect(types).toContain("tool.started");
    expect(types).toContain("tool.completed");
    expect(types).toContain("message.delta");
    expect(types[types.length - 1]).toBe("run.completed");
    const executedRecord = executed as { fqName: string; args: unknown } | null;
    expect(executedRecord?.fqName).toBe("docs:routeros_search");
    expect(executedRecord?.args).toEqual({ query: "safe mode" });
    // assistant message persisted with the final text
    const all = await db.select().from(messages).where(eq(messages.conversationId, ctx.conversationId));
    const assistant = all.filter((m) => m.role === "assistant");
    expect(assistant.length).toBe(1);
    expect((assistant[0]?.content as { text: string }).text).toContain("Configuration Management");
    // tool execution persisted with completed status
    const [te] = await db.select().from(toolExecutions).where(eq(toolExecutions.runId, ctx.runId));
    expect(te?.status).toBe("completed");
    expect(te?.toolName).toBe("docs:routeros_search");
    const [runRow] = await db.select().from(agentRuns).where(eq(agentRuns.id, ctx.runId));
    expect(runRow?.status).toBe("completed");
    expect((runRow?.usage as Record<string, number>).toolCalls).toBe(1);
  });

  test("incomplete JSON arguments are never executed — typed rejection, loop continues", async () => {
    if (!connected) return;
    const ctx = await setup();
    const loop = createAgentLoop({
      db,
      logger: silentLogger,
      dispatcher: stubDispatcher as never,
      txCoordinator: stubCoordinator as never,
      catalog: { getCatalog: async () => makeCatalog() },
      limits: { maxSteps: 5, maxToolCalls: 5, runTimeoutMs: 10_000, maxTokens: 1000 },
    });
    const events: RunEvent[] = [];
    let executed = 0;
    const client = makeScriptedClient([
      { toolCalls: [{ id: "call-1", name: "docs_routeros_search", argumentsJson: '{"query":"safe mo' }], text: "" },
      { text: "Argumen tidak valid, saya jawab dari pengetahuan saja." },
    ]);
    await loop.run(
      {
        ...ctx,
        connectionId: null,
        userText: "cari",
        policy: { userId: ctx.userId, connectionId: "none", mode: "read-only", modeVersion: 0, transactionState: "none" },
        client,
        executeTool: async () => {
          executed += 1;
          return { ok: true, output: "x" };
        },
        systemInstruction: "s",
      },
      async (e) => {
        events.push(e);
      },
    );
    expect(executed).toBe(0);
    const [te] = await db.select().from(toolExecutions).where(eq(toolExecutions.runId, ctx.runId));
    expect(te?.status).toBe("rejected");
    expect(te?.errorCode).toBe("VALIDATION_FAILED");
    const types = events.map((e) => e.type);
    expect(types[types.length - 1]).toBe("run.completed"); // run still completes with a final answer
  });

  test("dispatcher denial produces tool.failed with the policy code, run still completes", async () => {
    if (!connected) return;
    const ctx = await setup();
    const denyAll = {
      check: async () => ({ allowed: false as const, code: "MODE_WRITE_OFF", message: "mode read-only" }),
    };
    const loop = createAgentLoop({
      db,
      logger: silentLogger,
      dispatcher: denyAll as never,
      txCoordinator: stubCoordinator as never,
      catalog: { getCatalog: async () => makeCatalog() },
      limits: { maxSteps: 5, maxToolCalls: 5, runTimeoutMs: 10_000, maxTokens: 1000 },
    });
    const events: RunEvent[] = [];
    const client = makeScriptedClient([
      { toolCalls: [{ id: "call-1", name: "docs_routeros_search", argumentsJson: '{"query":"x"}' }], text: "" },
      { text: "Tool ditolak policy, saya jelaskan secara manual." },
    ]);
    await loop.run(
      {
        ...ctx,
        connectionId: null,
        userText: "cari",
        policy: { userId: ctx.userId, connectionId: "none", mode: "read-only", modeVersion: 0, transactionState: "none" },
        client,
        executeTool: async () => ({ ok: true, output: "never" }),
        systemInstruction: "s",
      },
      async (e) => {
        events.push(e);
      },
    );
    const failed = events.find((e) => e.type === "tool.failed");
    expect(failed?.payload.code).toBe("MODE_WRITE_OFF");
    const [te] = await db.select().from(toolExecutions).where(eq(toolExecutions.runId, ctx.runId));
    expect(te?.status).toBe("denied");
    expect(typesEnd(events)).toBe("run.completed");
  });

  test("write-mode tool call records the active transaction after an old committed transaction", async () => {
    if (!connected) return;
    const ctx = await setup();
    // a fake connection + active safe-mode tx for the write run
    const connId = crypto.randomUUID();
    await db.insert(routerConnections).values({
      id: connId,
      userId: ctx.userId,
      label: "loop-test-router",
      host: "192.0.2.99",
      port: 22,
      username: "admin",
      status: "connected",
    });
    await db.insert(changeTransactions).values({
      connectionId: connId, routerIdentity: "test-router", state: "committed",
    });
    const [tx] = await db
      .insert(changeTransactions)
      .values({
        connectionId: connId,
        routerIdentity: "test-router",
        state: "active",
      })
      .returning();
    let actions = 0;
    const countingCoordinator = {
      recordAction: (txId: string) => {
        if (txId === tx!.id) actions += 1;
      },
      getActionCount: (txId: string) => (txId === tx!.id ? actions : 0),
    };
    const loop = createAgentLoop({
      db,
      logger: silentLogger,
      dispatcher: stubDispatcher as never,
      txCoordinator: countingCoordinator as never,
      catalog: { getCatalog: async () => makeCatalog() },
      limits: { maxSteps: 5, maxToolCalls: 5, runTimeoutMs: 10_000, maxTokens: 1000 },
    });
    const events: RunEvent[] = [];
    const client = makeScriptedClient([
      { toolCalls: [{ id: "call-1", name: "docs_routeros_search", argumentsJson: '{"query":"x"}' }], text: "" },
      { text: "Mutasi tercatat dalam transaksi." },
    ]);
    await loop.run(
      {
        ...ctx,
        connectionId: connId,
        userText: "cari",
        policy: { userId: ctx.userId, connectionId: connId, mode: "write", modeVersion: 1, transactionState: "active" },
        client,
        executeTool: async () => ({ ok: true, output: "ok" }),
        systemInstruction: "s",
      },
      async (e) => {
        events.push(e);
      },
    );
    const txEvents = events.filter((e) => e.type === "transaction.updated");
    expect(txEvents.length).toBe(1);
    expect(txEvents[0]?.payload.transactionId).toBe(tx!.id);
    expect(txEvents[0]?.payload.state).toBe("active");
    expect(txEvents[0]?.payload.actions).toBe(1);
  });

  test("tool budget exceeded fails the run with TOOL_CALL_BUDGET", async () => {
    if (!connected) return;
    const ctx = await setup();
    const loop = createAgentLoop({
      db,
      logger: silentLogger,
      dispatcher: stubDispatcher as never,
      txCoordinator: stubCoordinator as never,
      catalog: { getCatalog: async () => makeCatalog() },
      limits: { maxSteps: 10, maxToolCalls: 1, runTimeoutMs: 10_000, maxTokens: 1000 },
    });
    const events: RunEvent[] = [];
    // every turn requests a NEW tool call id → second call busts the budget
    const client = makeScriptedClient([
      { toolCalls: [{ id: "call-1", name: "docs_routeros_search", argumentsJson: '{"query":"a"}' }], text: "" },
      { toolCalls: [{ id: "call-2", name: "docs_routeros_search", argumentsJson: '{"query":"b"}' }], text: "" },
      { text: "final" },
    ]);
    await loop.run(
      {
        ...ctx,
        connectionId: null,
        userText: "cari",
        policy: { userId: ctx.userId, connectionId: "none", mode: "read-only", modeVersion: 0, transactionState: "none" },
        client,
        executeTool: async () => ({ ok: true, output: "ok" }),
        systemInstruction: "s",
      },
      async (e) => {
        events.push(e);
      },
    );
    const failed = events.find((e) => e.type === "run.failed");
    expect(failed?.payload.code).toBe("TOOL_CALL_BUDGET");
    const [runRow] = await db.select().from(agentRuns).where(eq(agentRuns.id, ctx.runId));
    expect(runRow?.status).toBe("failed");
  });
});

function typesEnd(events: RunEvent[]): string {
  return events[events.length - 1]?.type ?? "";
}
