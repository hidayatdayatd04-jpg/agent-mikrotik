import { describe, expect, test, beforeEach } from "bun:test";
import { createAgentLoop } from "./loop";
import { readConnectionStatus } from "./loop";
import type { ChatClient, ChatToolCall } from "./chat-client";
import { agentRuns, conversations, messages, toolExecutions, workspaces, routerConnections, connectionPermissions } from "../db/schema";
import { createDb, type Database } from "../db";
import { eq } from "drizzle-orm";

let db: Database;

const silentLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => silentLogger,
} as unknown as Parameters<typeof createAgentLoop>[0]["logger"];

const stubDispatcher = {
  check: async () => {
    throw new Error("dispatcher must not be consulted for the connection probe");
  },
};
const stubCoordinator = { recordAction: () => {}, getActionCount: () => 0 };

beforeEach(async () => {
  db = createDb(":memory:");
  await db.run("select 1");
});

async function setup() {
  const [u] = await db.insert(workspaces).values({ name: "conn-check" }).returning();
  const [c] = await db.insert(conversations).values({ userId: u!.id, title: "t" }).returning();
  const [m] = await db
    .insert(messages)
    .values({ conversationId: c!.id, role: "user", content: { text: "apakah write aktif?" }, status: "complete", seq: 1 })
    .returning();
  const [r] = await db.insert(agentRuns).values({ conversationId: c!.id, userId: u!.id, status: "queued", policyVersion: 1 }).returning();
  return { userId: u!.id, conversationId: c!.id, userMessageId: m!.id, runId: r!.id };
}

function scriptedClient(calls: ChatToolCall[]): ChatClient {
  let turn = 0;
  return {
    modelLabel: "scripted-conn-check",
    async *stream() {
      if (turn === 0) {
        turn += 1;
        yield { type: "tool_calls" as const, toolCalls: calls };
        yield { type: "text" as const, text: "" };
        yield { type: "done" as const };
        return;
      }
      yield { type: "text" as const, text: "Baik, saya lanjutkan." };
      yield { type: "done" as const };
    },
  };
}

describe("system:check_connection (live probe for the model)", () => {
  test("tanpa router → connected:false, run tetap selesai", async () => {
    const ctx = await setup();
    const loop = createAgentLoop({ db, logger: silentLogger, dispatcher: stubDispatcher as never, txCoordinator: stubCoordinator as never, catalog: { getCatalog: async () => [] }, limits: { maxSteps: 4, maxToolCalls: 4, runTimeoutMs: 10000, maxTokens: 100 } });
    const events: { type: string; payload: Record<string, unknown> }[] = [];
    const res = await loop.run(
      {
        ...ctx,
        connectionId: null,
        userText: "apakah write aktif?",
        policy: { userId: ctx.userId, connectionId: "none", mode: "read-only", modeVersion: 0, transactionState: "none" },
        client: scriptedClient([{ id: "call_1", name: "system_check_connection", argumentsJson: "{}" }]),
        executeTool: async () => { throw new Error("must not reach executor"); },
        systemInstruction: "s",
      },
      async (e) => { events.push(e); },
    );
    expect(res).toEqual({ status: "completed" });
    const rows = await db.select().from(toolExecutions).where(eq(toolExecutions.runId, ctx.runId));
    expect(rows.length).toBe(1);
    expect(rows[0]).toMatchObject({ toolName: "system:check_connection", status: "completed" });
    const done = events.find((e) => e.type === "tool.completed");
    expect(String((done?.payload as { summary?: string }).summary ?? "")).toMatch(/Belum terhubung/);
    // assistant message carries runId for per-message pipelines
    const saved = await db.select().from(messages).where(eq(messages.conversationId, ctx.conversationId));
    expect((saved.find((m) => m.role === "assistant")?.content as { runId?: string }).runId).toBe(ctx.runId);
  });

  test("router connected + write + tx aktif → writeAllowed:true", async () => {
    const ctx = await setup();
    const [conn] = await db
      .insert(routerConnections)
      .values({ userId: ctx.userId, label: "CHR", host: "192.168.1.1", port: 22, username: "admin", status: "connected", routerIdentity: "CHR" })
      .returning();
    await db.insert(connectionPermissions).values({ userId: ctx.userId, connectionId: conn!.id, writeEnabled: true, version: 2 });
    const live = await readConnectionStatus(db, { userId: ctx.userId, connectionId: conn!.id, txActive: true });
    expect(live).toMatchObject({ connected: true, mode: "write", modeVersion: 2, txActive: true, writeAllowed: true });
  });

  test("router disconnected → connected:false beserta status aslinya", async () => {
    const ctx = await setup();
    const [conn] = await db
      .insert(routerConnections)
      .values({ userId: ctx.userId, label: "CHR", host: "192.168.1.1", port: 22, username: "admin", status: "disconnected", routerIdentity: "CHR" })
      .returning();
    const live = await readConnectionStatus(db, { userId: ctx.userId, connectionId: conn!.id, txActive: false });
    expect(live.connected).toBe(false);
    expect(live.status).toBe("disconnected");
    expect(live.writeAllowed).toBe(false);
  });

  test("connector milik user lain tidak bocor (dianggap no-router)", async () => {
    const ctx = await setup();
    const [other] = await db.insert(workspaces).values({ name: "other" }).returning();
    const [conn] = await db
      .insert(routerConnections)
      .values({ userId: other!.id, label: "X", host: "10.0.0.1", port: 22, username: "admin", status: "connected", routerIdentity: "X" })
      .returning();
    const live = await readConnectionStatus(db, { userId: ctx.userId, connectionId: conn!.id, txActive: true });
    expect(live.status).toBe("no-router");
    expect(live.host).toBeNull();
  });
});
