import type { Database } from "../db";
import { agentRuns, messages, toolExecutions, changeTransactions } from "../db/schema";
import { eq, asc } from "drizzle-orm";
import { AppError } from "../lib/errors";
import { redactText, redactObject } from "../lib/redaction";
import type { Logger } from "../lib/logger";
import type { ChatClient, ChatMessage, ChatToolCall, ChatToolDefinition } from "./chat-client";
import type { PolicyDispatcher, PolicySnapshot } from "../policies/dispatcher";
import type { TransactionCoordinator } from "../transactions/coordinator";
import type { NormalizedTool } from "../policies/normalize";

/**
 * Agent loop (M7): user message → provider stream → validate COMPLETE tool
 * calls → policy dispatch → tool result → next request → final answer.
 *
 * Invariants:
 *  - partial JSON arguments are never executed (wait for the full call);
 *  - every tool call goes through the PolicyDispatcher at execution time;
 *  - write-mode mutations run inside a Safe Mode transaction (M6) — the loop
 *    never enables/commits safe mode itself; the backend coordinator does;
 *  - router output is redacted before it reaches provider/browser/storage;
 *  - limits: max agent steps, max tool calls, run deadline;
 *  - cancellation stops new work server-side.
 */

export interface RunEvent {
  type:
    | "run.started"
    | "message.delta"
    | "tool.started"
    | "tool.completed"
    | "tool.failed"
    | "transaction.updated"
    | "run.completed"
    | "run.failed"
    | "run.cancelled";
  seq: number;
  runId: string;
  payload: Record<string, unknown>;
}

export interface AgentRunDeps {
  db: Database;
  logger: Logger;
  dispatcher: PolicyDispatcher;
  txCoordinator: TransactionCoordinator;
  catalog: { getCatalog(mode: "read-only" | "write"): Promise<NormalizedTool[]> };
  limits: { maxSteps: number; maxToolCalls: number; runTimeoutMs: number; maxTokens: number };
}

export interface StartRunInput {
  runId: string;
  userId: string;
  conversationId: string;
  connectionId: string | null;
  userMessageId: string;
  userText: string;
  policy: PolicySnapshot;
  /** Per-run provider client (user-configured provider or mock). */
  client: ChatClient;
  /** Executes a dispatched tool on the user's MCP child; backend-owned. */
  executeTool: (input: { fqName: string; args: unknown }) => Promise<{ ok: boolean; output: string; errorCode?: string }>;
  /** System instruction with mode/router/doc rules for this run. */
  systemInstruction: string;
}

const MAX_TOOL_RESULT_CHARS = 8_000;

export function createAgentLoop(deps: AgentRunDeps) {
  const activeRuns = new Map<string, { cancelled: boolean }>();

  function isCancelled(runId: string) {
    return activeRuns.get(runId)?.cancelled ?? false;
  }

  function cancel(runId: string) {
    const entry = activeRuns.get(runId);
    if (entry) entry.cancelled = true;
  }

  function toProviderTools(catalog: NormalizedTool[]): ChatToolDefinition[] {
    return catalog.map((t) => ({
      type: "function" as const,
      function: {
        name: t.fqName.replace(/[^A-Za-z0-9_-]/g, "_"),
        description: t.description.slice(0, 1024),
        parameters: (t.inputSchema && typeof t.inputSchema === "object"
          ? (t.inputSchema as Record<string, unknown>)
          : { type: "object", properties: {} }),
      },
    }));
  }

  /** Execute one dispatched tool with redaction + persistence. Returns SSE events. */
  async function runTool(
    input: StartRunInput,
    call: ChatToolCall,
    fqName: string,
    args: unknown,
    catalog: NormalizedTool[],
    emit: (e: Omit<RunEvent, "seq" | "runId">) => Promise<void>,
    toolIndex: number,
  ): Promise<{ role: "tool"; content: string; toolCallId: string }> {
    const started = Date.now();
    await emit({ type: "tool.started", payload: { callId: call.id, name: fqName, index: toolIndex } });
    let decision: Awaited<ReturnType<PolicyDispatcher["check"]>>;
    try {
      decision = await deps.dispatcher.check({
        session: { userId: input.userId },
        snapshot: { ...input.policy },
        toolFqName: fqName,
        args,
      });
    } catch (err) {
      // mode/ownership probes throwing must surface as a typed tool denial,
      // never crash the run (e.g. no router bound to the conversation)
      const code = err instanceof AppError ? err.code : "INTERNAL_ERROR";
      const message = err instanceof AppError ? err.message : "Pemeriksaan policy gagal.";
      await deps.db
        .insert(toolExecutions)
        .values({
          runId: input.runId,
          toolCallId: call.id,
          toolName: fqName,
          risk: "unknown",
          sanitizedInput: redactObject(args ?? {}),
          resultSummary: null,
          status: "denied",
          errorCode: code,
          durationMs: Date.now() - started,
        })
        .onConflictDoNothing();
      await emit({ type: "tool.failed", payload: { callId: call.id, name: fqName, code, message } });
      return {
        role: "tool",
        content: JSON.stringify({ error: code, message }),
        toolCallId: call.id,
      };
    }
    if (!decision.allowed) {
      const record = {
        runId: input.runId,
        toolCallId: call.id,
        toolName: fqName,
        risk: "unknown",
        sanitizedInput: redactObject(args ?? {}),
        resultSummary: null,
        status: "denied",
        errorCode: decision.code,
        durationMs: Date.now() - started,
      };
      await deps.db.insert(toolExecutions).values(record).onConflictDoNothing();
      await emit({ type: "tool.failed", payload: { callId: call.id, name: fqName, code: decision.code, message: decision.message } });
      return {
        role: "tool",
        content: JSON.stringify({ error: decision.code, message: decision.message }),
        toolCallId: call.id,
      };
    }
    let result: { ok: boolean; output: string; errorCode?: string };
    try {
      result = await input.executeTool({ fqName, args });
    } catch (err) {
      result = { ok: false, output: err instanceof Error ? err.message : String(err), errorCode: "INTERNAL_ERROR" };
    }
    const redacted = redactText(result.output).slice(0, MAX_TOOL_RESULT_CHARS);
    await deps.db
      .insert(toolExecutions)
      .values({
        runId: input.runId,
        toolCallId: call.id,
        toolName: fqName,
        risk: decision.tool.risk,
        sanitizedInput: redactObject(args ?? {}),
        resultSummary: redacted.slice(0, 500),
        status: result.ok ? "completed" : "failed",
        errorCode: result.errorCode ?? null,
        durationMs: Date.now() - started,
      })
      .onConflictDoNothing();
    if (result.ok) {
      await emit({ type: "tool.completed", payload: { callId: call.id, name: fqName, summary: redacted.slice(0, 400), index: toolIndex } });
    } else {
      await emit({ type: "tool.failed", payload: { callId: call.id, name: fqName, code: result.errorCode ?? "TOOL_FAILED", summary: redacted.slice(0, 400) } });
    }
    void catalog;
    return {
      role: "tool",
      content: JSON.stringify(result.ok ? { ok: true, output: redacted } : { ok: false, error: result.errorCode ?? "TOOL_FAILED", output: redacted }),
      toolCallId: call.id,
    };
  }

  /**
   * Runs the whole agent loop. Emits SSE events via `emit`. Persists partial
   * assistant output even on failure. Never re-executes mutations on retry.
   */
  async function run(
    input: StartRunInput,
    emit: (e: RunEvent) => Promise<void>,
  ): Promise<void> {
    const entry = { cancelled: false };
    activeRuns.set(input.runId, entry);
    const deadline = Date.now() + deps.limits.runTimeoutMs;
    let seqCounter = 0;
    const emitSeq = async (e: Omit<RunEvent, "seq" | "runId">) => {
      seqCounter += 1;
      const event: RunEvent = { ...e, runId: input.runId, seq: seqCounter };
      await emit(event);
    };
    let finalStatus = "completed";
    let failCode: string | null = null;
    let failMessage: string | null = null;
    try {
      await deps.db.update(agentRuns).set({ status: "running", startedAt: new Date() }).where(eq(agentRuns.id, input.runId));
      await emitSeq({ type: "run.started", payload: { conversationId: input.conversationId } });

      // conversation history for the provider (bounded window)
      const history = await deps.db
        .select()
        .from(messages)
        .where(eq(messages.conversationId, input.conversationId))
        .orderBy(asc(messages.seq))
        .limit(40);
      const chatHistory: ChatMessage[] = [{ role: "system", content: input.systemInstruction }];
      for (const m of history.slice(-24)) {
        if (m.role === "user") {
          const content = m.content as { text?: string; context?: string };
          chatHistory.push({ role: "user", content: String(content?.text ?? "") + (content?.context ?? "") });
        } else if (m.role === "assistant") {
          chatHistory.push({ role: "assistant", content: String((m.content as { text?: string })?.text ?? "") });
        }
      }

      // no router bound → documentation tools only; router tools would fail
      // ownership checks anyway and waste a provider turn
      const fullCatalog = await deps.catalog.getCatalog(input.policy.mode);
      const catalog = input.connectionId ? fullCatalog : fullCatalog.filter((t) => t.fqName.startsWith("docs:"));
      const providerTools = toProviderTools(catalog);
      const toolCallCount = new Map<string, number>(); // dedup tool call ids
      let toolCallsTotal = 0;
      let assistantText = "";
      let usage: { promptTokens: number; completionTokens: number } | null = null;

      for (let step = 0; step < deps.limits.maxSteps; step++) {
        if (isCancelled(input.runId)) {
          finalStatus = "cancelled";
          break;
        }
        if (Date.now() > deadline) {
          finalStatus = "failed";
          failCode = "RUN_TIMEOUT";
          failMessage = "Run melebihi batas waktu server.";
          break;
        }
        let stepText = "";
        let stepToolCalls: ChatToolCall[] = [];
        for await (const ev of input.client.stream({
          messages: chatHistory,
          tools: providerTools,
          maxTokens: deps.limits.maxTokens,
        })) {
          if (ev.type === "text" && ev.text) {
            stepText += ev.text;
            assistantText += ev.text;
            await emitSeq({ type: "message.delta", payload: { text: ev.text } });
          } else if (ev.type === "tool_calls" && ev.toolCalls) {
            stepToolCalls = ev.toolCalls;
          } else if (ev.type === "usage" && ev.usage) {
            usage = ev.usage;
          } else if (ev.type === "done") {
            break;
          }
        }
        if (finalStatus !== "completed") break;
        if (stepToolCalls.length === 0) {
          // final answer turn
          chatHistory.push({ role: "assistant", content: stepText });
          break;
        }
        // assistant turn with tool calls — persist pair and execute each
        chatHistory.push({ role: "assistant", content: stepText || null, toolCalls: stepToolCalls });
        for (const [i, call] of stepToolCalls.entries()) {
          if (isCancelled(input.runId)) {
            finalStatus = "cancelled";
            break;
          }
          if (toolCallsTotal >= deps.limits.maxToolCalls) {
            finalStatus = "failed";
            failCode = "TOOL_CALL_BUDGET";
            failMessage = `Batas ${deps.limits.maxToolCalls} tool call per run tercapai.`;
            break;
          }
          toolCallsTotal += 1;
          if (toolCallCount.has(call.id)) {
            // dedup repeated ids: still answer with a tool message to keep
            // the provider's required assistant(tool_calls) → tool alternation
            chatHistory.push({ role: "tool", content: JSON.stringify({ error: "DUPLICATE_CALL", message: "Panggilan duplikat diabaikan." }), toolCallId: call.id });
            continue;
          }
          toolCallCount.set(call.id, 1);
          // WAIT for complete arguments: parse JSON; incomplete → typed error result, never executed
          let args: unknown;
          try {
            args = call.argumentsJson.trim() ? JSON.parse(call.argumentsJson) : {};
          } catch {
            const msg = "Argumen tool bukan JSON lengkap — tidak dieksekusi.";
            await deps.db
              .insert(toolExecutions)
              .values({
                runId: input.runId,
                toolCallId: call.id,
                toolName: call.name,
                risk: "unknown",
                sanitizedInput: null,
                resultSummary: msg,
                status: "rejected",
                errorCode: "VALIDATION_FAILED",
              })
              .onConflictDoNothing();
            chatHistory.push({ role: "tool", content: JSON.stringify({ error: "VALIDATION_FAILED", message: msg }), toolCallId: call.id });
            continue;
          }
          // map provider tool name back to fqName (dots replaced by _ in provider space)
          const fq = catalog.find((t) => t.fqName.replace(/[^A-Za-z0-9_-]/g, "_") === call.name)?.fqName ?? call.name;
          const toolMsg = await runTool(input, call, fq, args, catalog, emitSeq, i);
          chatHistory.push(toolMsg);
          // transaction-aware tool calls recorded against the active tx
          if (input.policy.mode === "write") {
            const [tx] = await deps.db
              .select()
              .from(changeTransactions)
              .where(eq(changeTransactions.connectionId, input.connectionId ?? ""))
              .limit(1);
            if (tx) {
              try {
                deps.txCoordinator.recordAction(tx.id);
                await emitSeq({
                  type: "transaction.updated",
                  payload: {
                    transactionId: tx.id,
                    state: tx.state,
                    actions: deps.txCoordinator.getActionCount(tx.id),
                  },
                });
              } catch (err) {
                if (err instanceof AppError) {
                  chatHistory.push({
                    role: "system",
                    content: `Batas aksi transaksi tercapai: ${err.message}`,
                  });
                }
              }
            }
          }
        }
        if (finalStatus !== "completed") break;
      }

      // persist the final/partial assistant message
      const all = await deps.db
        .select({ seq: messages.seq })
        .from(messages)
        .where(eq(messages.conversationId, input.conversationId));
      const maxSeq = all.reduce((m, r) => Math.max(m, r.seq), 0);
      await deps.db.insert(messages).values({
        conversationId: input.conversationId,
        role: "assistant",
        content: { text: redactText(assistantText) },
        status: finalStatus === "completed" ? "complete" : finalStatus,
        seq: maxSeq + 1,
      });
      await deps.db
        .update(agentRuns)
        .set({
          status: finalStatus,
          endedAt: new Date(),
          usage: usage ? { ...usage, toolCalls: toolCallsTotal } : { toolCalls: toolCallsTotal },
        })
        .where(eq(agentRuns.id, input.runId));
      if (finalStatus === "completed") {
        await emitSeq({ type: "run.completed", payload: { usage: usage ?? null } });
      } else if (finalStatus === "cancelled") {
        await emitSeq({ type: "run.cancelled", payload: { reason: "dibatalkan pengguna" } });
      } else {
        await emitSeq({ type: "run.failed", payload: { code: failCode ?? "RUN_FAILED", message: failMessage ?? "Run gagal." } });
      }
    } catch (err) {
      deps.logger.error("agent run crashed", { runId: input.runId, message: err instanceof Error ? err.message : String(err) });
      finalStatus = "failed";
      failCode = err instanceof AppError ? err.code : "INTERNAL_ERROR";
      failMessage = err instanceof Error ? err.message : String(err);
      await deps.db
        .update(agentRuns)
        .set({ status: "failed", endedAt: new Date(), usage: { error: failCode } })
        .where(eq(agentRuns.id, input.runId))
        .catch(() => {});
      await emitSeq({ type: "run.failed", payload: { code: failCode, message: failMessage ?? "" } });
    } finally {
      activeRuns.delete(input.runId);
    }
  }

  return { run, cancel, isCancelled };
}

export type AgentLoop = ReturnType<typeof createAgentLoop>;
