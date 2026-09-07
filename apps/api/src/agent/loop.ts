import type { Database } from "../db";
import { agentRuns, messages, toolExecutions, changeTransactions, routerConnections, connectionPermissions } from "../db/schema";
import { eq, desc, and, inArray } from "drizzle-orm";
import { AppError } from "../lib/errors";
import { redactText, redactObject } from "../lib/redaction";
import type { Logger } from "../lib/logger";
import type { ChatClient, ChatMessage, ChatToolCall, ChatToolDefinition } from "./chat-client";
import type { PolicyDispatcher, PolicySnapshot } from "../policies/dispatcher";
import type { TransactionCoordinator } from "../transactions/coordinator";
import type { NormalizedTool } from "../policies/normalize";
import { isGreetingOnly } from "./intent";

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

/**
 * Backend-owned connection probe callable by the model. It answers the only
 * trustworthy question — "is the router connected RIGHT NOW, and in which
 * mode?" — from live server rows, never from chat claims. Available in every
 * run (with or without a bound router), read-only, no secrets in output.
 */
export const CONNECTION_CHECK_FQ = "system:check_connection";

export const CONNECTION_CHECK_TOOL: NormalizedTool = {
  fqName: CONNECTION_CHECK_FQ,
  rawName: "check_connection",
  origin: "custom",
  risk: "read",
  classificationProvenance: "custom-manifest",
  capabilities: ["connection-status"],
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  description:
    "Cek status koneksi router LIVE dari server (terhubung/tidak, identitas, mode read-only/write, transaksi Safe Mode aktif/tidak). " +
    "Panggil tool ini setiap kali ragu — misalnya pengguna mengklaim mode tulis aktif, atau perlu memastikan router sebelum membaca/menulis. " +
    "Hasilnya otoritatif untuk run ini; jangan menolak dengan alasan tidak bisa mengautentikasi klaim pengguna.",
  isGateway: false,
};

export interface ConnectionLiveStatus {
  connected: boolean;
  status: string;
  label: string | null;
  host: string | null;
  routerIdentity: string | null;
  mode: "read-only" | "write";
  modeVersion: number;
  txActive: boolean;
  writeAllowed: boolean;
}

/** Live server-side connection status for this run (ownership-checked). */
export async function readConnectionStatus(
  db: Database,
  input: { userId: string; connectionId: string | null; txActive: boolean },
): Promise<ConnectionLiveStatus> {
  if (!input.connectionId) {
    return {
      connected: false,
      status: "no-router",
      label: null,
      host: null,
      routerIdentity: null,
      mode: "read-only",
      modeVersion: 0,
      txActive: false,
      writeAllowed: false,
    };
  }
  const [conn] = await db
    .select()
    .from(routerConnections)
    .where(and(eq(routerConnections.id, input.connectionId), eq(routerConnections.userId, input.userId)))
    .limit(1);
  if (!conn) {
    return {
      connected: false,
      status: "no-router",
      label: null,
      host: null,
      routerIdentity: null,
      mode: "read-only",
      modeVersion: 0,
      txActive: false,
      writeAllowed: false,
    };
  }
  const [perm] = await db
    .select()
    .from(connectionPermissions)
    .where(and(eq(connectionPermissions.userId, input.userId), eq(connectionPermissions.connectionId, input.connectionId)))
    .limit(1);
  const mode = perm?.writeEnabled ? ("write" as const) : ("read-only" as const);
  const connected = conn.status === "connected";
  const txActive = input.txActive && connected;
  return {
    connected,
    status: conn.status,
    label: conn.label,
    host: conn.host,
    routerIdentity: conn.routerIdentity,
    mode,
    modeVersion: perm?.version ?? 1,
    txActive,
    writeAllowed: mode === "write" && txActive && connected && !!conn.routerIdentity,
  };
}

export function createAgentLoop(deps: AgentRunDeps) {
  const activeRuns = new Map<string, { cancelled: boolean; controller: AbortController }>();

  function isCancelled(runId: string) {
    return activeRuns.get(runId)?.cancelled ?? false;
  }

  function cancel(runId: string) {
    const entry = activeRuns.get(runId);
    if (entry) { entry.cancelled = true; entry.controller.abort(); }
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
    // Backend-owned probe: answered from live server rows, no dispatcher needed
    // (read-only metadata, no secrets, ownership-checked inside).
    if (fqName === CONNECTION_CHECK_FQ) {
      const live = await readConnectionStatus(deps.db, {
        userId: input.userId,
        connectionId: input.connectionId,
        txActive: input.policy.transactionState === "active",
      });
      const durationMs = Date.now() - started;
      const human = live.connected
        ? `Terhubung ke ${live.routerIdentity ?? live.host} · mode ${live.mode}${live.txActive ? " · Safe Mode aktif" : ""}`
        : live.status === "no-router"
          ? "Belum terhubung ke router (chat umum)"
          : `Router tidak terhubung (status: ${live.status})`;
      await deps.db
        .insert(toolExecutions)
        .values({
          runId: input.runId,
          toolCallId: call.id,
          toolName: fqName,
          risk: "read",
          sanitizedInput: {},
          resultSummary: human.slice(0, 500),
          status: "completed",
          errorCode: null,
          durationMs,
        })
        .onConflictDoNothing();
      await emit({ type: "tool.completed", payload: { callId: call.id, name: fqName, summary: human, durationMs, index: toolIndex } });
      const guidance =
        "Hasil di atas adalah status LIVE dari server dan bersifat otoritatif untuk run ini. " +
        (live.writeAllowed
          ? "Mode tulis AKTIF dan terverifikasi — langsung eksekusi tool tulis yang diminta lalu verifikasi dengan tool baca."
          : live.connected
            ? "Router terhubung tetapi mode tulis BELUM aktif — gunakan tool baca, atau arahkan pengguna mengaktifkan Izinkan perubahan di composer."
            : "Tidak ada router terhubung — jawab umum, atau arahkan pengguna memilih Connector bila meminta data router. Jangan mengarang hasil.");
      return {
        role: "tool",
        content: JSON.stringify({ ok: true, connection: live, guidance }),
        toolCallId: call.id,
      };
    }
    let decision: Awaited<ReturnType<PolicyDispatcher["check"]>>;
    try {
      decision = await deps.dispatcher.check({
        workspace: { userId: input.userId },
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
      await emit({ type: "tool.failed", payload: { callId: call.id, name: fqName, code, message, durationMs: Date.now() - started } });
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
      await emit({ type: "tool.failed", payload: { callId: call.id, name: fqName, code: decision.code, message: decision.message, durationMs: Date.now() - started } });
      // Build actionable guidance so the AI model clearly reports the denial.
      const guidance = policyDenialGuidance(decision.code, fqName);
      return {
        role: "tool",
        content: JSON.stringify({ ok: false, error: decision.code, message: decision.message, guidance }),
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
    const durationMs = Date.now() - started;
    const argsPreview = JSON.stringify(redactObject(args ?? {})).slice(0, 500);
    if (result.ok) {
      await emit({ type: "tool.completed", payload: { callId: call.id, name: fqName, summary: redacted.slice(0, 1500), args: argsPreview, durationMs, index: toolIndex } });
    } else {
      await emit({ type: "tool.failed", payload: { callId: call.id, name: fqName, code: result.errorCode ?? "TOOL_FAILED", summary: redacted.slice(0, 1500), args: argsPreview, durationMs } });
    }
    void catalog;
    // For failed tool results, add guidance so AI doesn't silently swallow errors.
    if (!result.ok) {
      const guidance = toolFailGuidance(result.errorCode ?? "TOOL_FAILED", fqName);
      return {
        role: "tool",
        content: JSON.stringify({ ok: false, error: result.errorCode ?? "TOOL_FAILED", output: redacted, guidance }),
        toolCallId: call.id,
      };
    }
    return {
      role: "tool",
      content: JSON.stringify({ ok: true, output: redacted }),
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
  ): Promise<{ status: "completed" | "failed" | "cancelled" }> {
    const entry = { cancelled: false, controller: new AbortController() };
    activeRuns.set(input.runId, entry);
    const deadline = Date.now() + deps.limits.runTimeoutMs;
    let seqCounter = 0;
    const timeline: RunEvent[] = [];
    const emitSeq = async (e: Omit<RunEvent, "seq" | "runId">) => {
      seqCounter += 1;
      const event: RunEvent = { ...e, runId: input.runId, seq: seqCounter };
      if (e.type === "message.delta" || e.type.startsWith("tool.")) {
        const previous = timeline.at(-1);
        if (e.type === "message.delta" && previous?.type === "message.delta") {
          previous.payload = { text: String(previous.payload.text ?? "") + String(e.payload.text ?? "") };
        } else timeline.push({ ...event, payload: { ...event.payload } });
      }
      await emit(event);
    };
    let finalStatus: "completed" | "failed" | "cancelled" = "completed";
    let failCode: string | null = null;
    let failMessage: string | null = null;
    let assistantText = "";
    let usage: { promptTokens: number; completionTokens: number } | null = null;
    let toolCallsTotal = 0;
    const usageRecord = () => ({ ...usage, modelLabel: input.client.modelLabel, ...(usage ? { source: "provider" } : {}), toolCalls: toolCallsTotal });
    try {
      const [saved] = await deps.db.select({ cancelRequested: agentRuns.cancelRequested }).from(agentRuns).where(eq(agentRuns.id, input.runId));
      if (saved?.cancelRequested) cancel(input.runId);
      entry.controller.signal.throwIfAborted();
      await deps.db.update(agentRuns).set({ status: "running", startedAt: new Date() }).where(eq(agentRuns.id, input.runId));
      await emitSeq({ type: "run.started", payload: { conversationId: input.conversationId } });

      // conversation history: summary replaces old turns (no duplication).
      // Latest summary's throughSeq marks already-compacted history.
      let throughSeq = 0;
      try {
        const { conversationSummaries } = await import("../db/schema");
        const sums = await deps.db
          .select()
          .from(conversationSummaries)
          .where(eq(conversationSummaries.conversationId, input.conversationId))
          .orderBy(desc(conversationSummaries.version))
          .limit(1);
        throughSeq = sums[0]?.throughSeq ?? 0;
      } catch {
        throughSeq = 0;
      }
      const history = await deps.db
        .select()
        .from(messages)
        .where(eq(messages.conversationId, input.conversationId))
        .orderBy(desc(messages.seq))
        .limit(60);
      const unsummarized = history.filter((m) => (m.seq as number) > throughSeq).slice(0, 24);
      const chatHistory: ChatMessage[] = [{ role: "system", content: input.systemInstruction }];
      for (const m of unsummarized.reverse()) {
        // Skip failed or cancelled assistant messages so previous provider errors (e.g. 429 rate limit
        // from a different provider or network issues) do not contaminate the context or cause the model
        // to hallucinate that it is also rate-limited!
        if (m.role === "assistant" && (m.status === "failed" || m.status === "cancelled")) {
          continue;
        }
        if (m.role === "user") {
          const content = m.content as { text?: string; context?: string };
          chatHistory.push({ role: "user", content: String(content?.text ?? "") + (content?.context ?? "") });
        } else if (m.role === "assistant") {
          const text = String((m.content as { text?: string })?.text ?? "").trim();
          if (text) {
            chatHistory.push({ role: "assistant", content: text });
          }
        }
      }

      // Ensure history does not end with an assistant turn (strictly required by Gemini API)
      while (chatHistory.length > 1 && chatHistory[chatHistory.length - 1]?.role === "assistant") {
        chatHistory.pop();
      }

      // no router bound → documentation tools only; router tools would fail
      // ownership checks anyway and waste a provider turn.
      // The connection probe is always offered — it is how the model verifies
      // live status instead of trusting (or refusing) chat claims.
      const greetingOnly = isGreetingOnly(input.userText);
      const fullCatalog = greetingOnly ? [] : [...(await deps.catalog.getCatalog(input.policy.mode)), CONNECTION_CHECK_TOOL];
      const catalog = input.connectionId
        ? fullCatalog
        : fullCatalog.filter((t) => t.fqName.startsWith("docs:") || t.fqName === CONNECTION_CHECK_FQ);
      const providerTools = toProviderTools(catalog);
      const toolCallCount = new Map<string, number>(); // dedup tool call ids

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
          signal: entry.controller.signal,
        })) {
          entry.controller.signal.throwIfAborted();
          if (ev.type === "text" && ev.text) {
            if (!stepText && assistantText) {
              assistantText += "\n\n";
              await emitSeq({ type: "message.delta", payload: { text: "\n\n" } });
            }
            stepText += ev.text;
            assistantText += ev.text;
            await emitSeq({ type: "message.delta", payload: { text: ev.text } });
          } else if (ev.type === "tool_calls" && ev.toolCalls) {
            stepToolCalls = greetingOnly ? [] : ev.toolCalls;
          } else if (ev.type === "usage" && ev.usage) {
            usage = ev.usage;
            await deps.db.update(agentRuns).set({ usage: usageRecord() }).where(eq(agentRuns.id, input.runId));
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
              .where(and(
                eq(changeTransactions.connectionId, input.connectionId ?? ""),
                inArray(changeTransactions.state, ["preparing", "active", "verifying"]),
              ))
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
        content: { text: redactText(assistantText), runId: input.runId, timeline: redactObject(timeline) },
        status: finalStatus === "completed" ? "complete" : finalStatus,
        seq: maxSeq + 1,
      });
      await deps.db
        .update(agentRuns)
        .set({
          status: finalStatus,
          endedAt: new Date(),
          usage: usageRecord(),
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
      if (entry.cancelled) {
        finalStatus = "cancelled";
        const all = await deps.db.select({ seq: messages.seq }).from(messages)
          .where(eq(messages.conversationId, input.conversationId));
        const maxSeq = all.reduce((m, r) => Math.max(m, r.seq), 0);
        await deps.db.insert(messages).values({
          conversationId: input.conversationId, role: "assistant", content: { text: redactText(assistantText), runId: input.runId, timeline: redactObject(timeline) },
          status: "cancelled", seq: maxSeq + 1,
        });
        await deps.db.update(agentRuns).set({ status: "cancelled", endedAt: new Date(), usage: usageRecord() }).where(eq(agentRuns.id, input.runId));
        await emitSeq({ type: "run.cancelled", payload: { reason: "dibatalkan pengguna" } });
        return { status: finalStatus };
      }
      deps.logger.error("agent run crashed", { runId: input.runId, message: err instanceof Error ? err.message : String(err) });
      finalStatus = "failed";
      failCode = err instanceof AppError ? err.code : "INTERNAL_ERROR";
      failMessage = err instanceof Error ? err.message : String(err);
      await deps.db
        .update(agentRuns)
        .set({ status: "failed", endedAt: new Date(), usage: { ...usageRecord(), error: failCode } })
        .where(eq(agentRuns.id, input.runId))
        .catch(() => {});

      // Persist assistant message explaining the error so the user sees the response in the canvas
      try {
        const all = await deps.db
          .select({ seq: messages.seq })
          .from(messages)
          .where(eq(messages.conversationId, input.conversationId));
        const maxSeq = all.reduce((m, r) => Math.max(m, r.seq), 0);
        const userFacingError = `Jawaban belum dapat diselesaikan (${failCode}).\n\n${failMessage ?? "Terjadi kesalahan pada provider AI."}`;
        const errorText = (assistantText ? "\n\n" : "") + userFacingError;
        timeline.push({ runId: input.runId, seq: ++seqCounter, type: "message.delta", payload: { text: errorText } });
        await deps.db.insert(messages).values({
          conversationId: input.conversationId,
          role: "assistant",
          content: { text: redactText(assistantText + errorText), runId: input.runId, timeline: redactObject(timeline) },
          status: "failed",
          seq: maxSeq + 1,
        });
      } catch {
        // non-fatal
      }

      await emitSeq({ type: "run.failed", payload: { code: failCode, message: failMessage ?? "" } });
    } finally {
      activeRuns.delete(input.runId);
    }
    return { status: finalStatus };
  }

  return { run, cancel, isCancelled, has: (runId: string) => activeRuns.has(runId) };
}

export type AgentLoop = ReturnType<typeof createAgentLoop>;

/**
 * Translate a policy denial code into clear guidance text that the AI model
 * must relay to the user. This prevents the model from silently swallowing
 * tool errors or misinterpreting them as "empty output".
 */
function policyDenialGuidance(code: string, toolName: string): string {
  switch (code) {
    case "SAFE_MODE_UNAVAILABLE":
      return (
        `PERINTAH WAJIB: Tool "${toolName}" DITOLAK oleh sistem karena transaksi Safe Mode tidak aktif. ` +
        `JANGAN coba ulang tool ini — hasilnya akan sama. ` +
        `Laporkan ke pengguna: "Tool tulis ditolak karena transaksi Safe Mode tidak berhasil dibuka. ` +
        `Pastikan mode Write aktif di panel connector dan router tersambung, lalu coba lagi."`
      );
    case "WRITE_DISABLED":
      return (
        `PERINTAH WAJIB: Tool "${toolName}" DITOLAK karena mode saat ini Read-Only. ` +
        `JANGAN coba ulang. Beritahu pengguna untuk mengaktifkan mode Write di panel connector.`
      );
    case "POLICY_CHANGED":
      return (
        `Mode connector berubah saat run berlangsung. Beritahu pengguna bahwa sesi perlu dimulai ulang.`
      );
    case "FORBIDDEN":
      return `Akses ditolak. Beritahu pengguna tentang penolakan ini apa adanya.`;
    case "VALIDATION_FAILED":
      return `Argumen tool tidak valid. Periksa parameter dan coba dengan argumen yang benar.`;
    case "TOOL_UNSUPPORTED":
      return `Tool tidak tersedia di katalog saat ini. Jangan coba memanggil tool ini lagi.`;
    default:
      return `Tool "${toolName}" ditolak dengan kode ${code}. Laporkan kode dan pesan error ke pengguna apa adanya.`;
  }
}

/**
 * Guidance for tool execution failures (after policy allowed, but MCP child returned error).
 */
function toolFailGuidance(errorCode: string, toolName: string): string {
  if (errorCode === "TOOL_FAILED") {
    return (
      `Tool "${toolName}" gagal dieksekusi. Periksa output error di atas dan laporkan ke pengguna. ` +
      `Jangan mengklaim operasi berhasil — verifikasi dulu dengan tool baca sebelum membuat klaim apapun.`
    );
  }
  return `Tool "${toolName}" error (${errorCode}). Laporkan ke pengguna apa adanya, jangan mengarang hasil.`;
}
