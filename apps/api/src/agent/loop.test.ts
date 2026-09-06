import { describe, expect, test, beforeEach } from "bun:test";
import { createAgentLoop, type RunEvent } from "./loop";
import type { ChatClient, StreamEvent, ChatToolCall } from "./chat-client";
import { agentRuns, conversations, messages, toolExecutions, users, changeTransactions, routerConnections } from "../db/schema";
import { createDb, type Database } from "../db";
import { eq } from "drizzle-orm";
import type { NormalizedTool } from "../policies/normalize";

/**
 * Agent loop unit tests against local Postgres with a scripted provider
 * client and a stub dispatcher — no real provider, no real router.
 * Turn 1: provider emits a tool call (valid JSON args).
 * Turn 2: provider sees the tool result and emits the final text.
 */
const dbUrl = process.env.DATABASE_URL ?? "postgres://dev:dev@localhost:5432/agent_mikrotik";

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
      yield { type: "done" } satisfies StreamEvent;
      if (step.usage) yield { type: "usage", usage: step.usage } satisfies StreamEvent;
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
  const [u] = await db.insert(users).values({ email: `loop-test-${Date.now()}@example.com`, name: "loop-test" }).returning();
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
      await db.execute("select 1");
    }
    await db.execute("select 1");
    connected = true;
  } catch {
    console.log("no local postgres; skipping agent loop tests");
  }
});

describe("agent loop (unit, local postgres)", () => {
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

  test("write-mode tool call emits transaction.updated with action count", async () => {
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
