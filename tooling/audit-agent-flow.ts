/** Offline audit reproducer. No provider requests, router calls, or persistent DB writes.
 * Run: bun tooling/audit-agent-flow.ts
 * Reports current behavior; this is not a regression suite asserting bugs as desired behavior.
 */
import { createDb } from "../apps/api/src/db";
import { agentRuns, conversations, messages, workspaces } from "../apps/api/src/db/schema";
import { createAgentLoop, type RunEvent } from "../apps/api/src/agent/loop";
import type { ChatClient } from "../apps/api/src/agent/chat-client";
import type { NormalizedTool } from "../apps/api/src/policies/normalize";

const tool: NormalizedTool = {
  fqName: "docs:read_fixture", rawName: "read_fixture", origin: "custom", risk: "read",
  classificationProvenance: "custom-manifest", capabilities: [], isGateway: false,
  description: "Offline audit fixture", inputSchema: { type: "object", properties: {} },
};

async function observe(kind: "deadline" | "step-limit" | "empty-answer" | "cached-failure") {
  const db = createDb(":memory:");
  const [workspace] = await db.insert(workspaces).values({ name: "offline-audit" }).returning();
  const [conversation] = await db.insert(conversations).values({ userId: workspace!.id }).returning();
  const [message] = await db.insert(messages).values({ conversationId: conversation!.id, role: "user", content: { text: "Read fixture" }, seq: 1 }).returning();
  const [run] = await db.insert(agentRuns).values({ conversationId: conversation!.id, userId: workspace!.id }).returning();
  const events: RunEvent[] = [];
  let turns = 0;
  let executions = 0;
  const realNow = Date.now;
  let clockOffset = 0;
  // Controlled clock only in this isolated diagnostic process, always restored.
  Date.now = () => realNow() + clockOffset;
  const client: ChatClient = {
    modelLabel: "offline-fixture",
    async *stream() {
      turns++;
      if (kind !== "empty-answer" && (turns === 1 || kind === "cached-failure" && turns === 2)) {
        yield { type: "tool_calls", toolCalls: [{ id: `call-${turns}`, name: "docs_read_fixture", argumentsJson: "{}" }] };
      } else if (kind !== "empty-answer") {
        yield { type: "text", text: "Fixture response." };
      }
      yield { type: "done", finishReason: "stop" };
    },
  };
  try {
    const loop = createAgentLoop({
      db,
      logger: { error() {}, warn() {}, info() {}, debug() {} } as never,
      dispatcher: { check: async () => ({ allowed: true, tool }) } as never,
      txCoordinator: { recordAction() {}, getActionCount: () => 0 } as never,
      catalog: { getCatalog: async () => [tool] },
      limits: { maxSteps: kind === "step-limit" ? 1 : 4, maxToolCalls: 8, runTimeoutMs: 1000, maxTokens: 100 },
    });
    const outcome = await loop.run({
      runId: run!.id, userId: workspace!.id, conversationId: conversation!.id,
      userMessageId: message!.id, connectionId: null, userText: "Read fixture", client,
      policy: { userId: workspace!.id, connectionId: "none", mode: "read-only", modeVersion: 0, transactionState: "none" },
      systemInstruction: "Offline fixture",
      executeTool: async () => {
        executions++;
        if (kind === "deadline") clockOffset = 2000;
        return kind === "cached-failure"
          ? { ok: false, output: "Fixture tool failed", errorCode: "TOOL_FAILED" }
          : { ok: true, output: "Fixture read succeeded" };
      },
    }, async (event) => { events.push(event); });
    const saved = (await db.select().from(messages)).find((m) => m.role === "assistant");
    const content = saved?.content as { text?: string } | undefined;
    console.log(JSON.stringify({ case: kind, outcome: outcome.status, turns, executions,
      assistantText: content?.text, terminal: events.at(-1),
      toolEvents: events.filter((e) => e.type === "tool.completed" || e.type === "tool.failed").map((e) => ({ type: e.type, cached: e.payload.cached ?? false })),
    }));
  } finally {
    Date.now = realNow;
    db.$client.close();
  }
}

for (const kind of ["deadline", "step-limit", "empty-answer", "cached-failure"] as const) await observe(kind);
