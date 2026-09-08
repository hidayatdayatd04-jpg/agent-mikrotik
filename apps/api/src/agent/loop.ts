import { eq } from "drizzle-orm";
import { agentRuns } from "../db/schema";
import { AppError } from "../lib/errors";
import { assembleHistory } from "./loop/history";
import { buildRunCatalog } from "./loop/catalog";
import { createEmitter, createRunCounters } from "./loop/context";
import { finalizeRun } from "./loop/finalize";
import { runAgentStep } from "./loop/step";
import type { AgentRunDeps, RunEvent, StartRunInput } from "./loop/types";

export type { AgentRunDeps, RunEvent, StartRunInput } from "./loop/types";
export { MAX_TOOL_RESULT_CHARS } from "./loop/types";
export { CONNECTION_CHECK_FQ, CONNECTION_CHECK_TOOL, readConnectionStatus } from "./loop/connection";
export type { ConnectionLiveStatus } from "./loop/connection";
export {
  MAX_PROVIDER_TOOLS,
  MAX_PROVIDER_SCHEMA_CHARS,
  selectRelevantTools,
  canonicalKey,
  findDirectToolsForQuery,
} from "./loop/ranking";
export { extractResearchPayload } from "./loop/research";

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
export function createAgentLoop(deps: AgentRunDeps) {
  const activeRuns = new Map<string, { cancelled: boolean; controller: AbortController }>();

  function isCancelled(runId: string) {
    return activeRuns.get(runId)?.cancelled ?? false;
  }

  function cancel(runId: string) {
    const entry = activeRuns.get(runId);
    if (entry) { entry.cancelled = true; entry.controller.abort(); }
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
    const counters = createRunCounters();
    const emitSeq = createEmitter(input.runId, emit, counters);
    const cancelledNow = () => isCancelled(input.runId);
    try {
      const [saved] = await deps.db.select({ cancelRequested: agentRuns.cancelRequested }).from(agentRuns).where(eq(agentRuns.id, input.runId));
      if (saved?.cancelRequested) cancel(input.runId);
      entry.controller.signal.throwIfAborted();
      await deps.db.update(agentRuns).set({ status: "running", startedAt: new Date() }).where(eq(agentRuns.id, input.runId));
      await emitSeq({ type: "run.started", payload: { conversationId: input.conversationId } });

      const { chatHistory } = await assembleHistory(deps.db, input);
      const { greetingOnly, catalog, providerTools } = await buildRunCatalog(deps.catalog, input);
      const toolCallCount = new Map<string, number>(); // dedup tool call ids
      // Guard anti-loop: tool sama + argumen identik yang diulang tanpa
      // kemajuan → pakai cache / hentikan run (hemat kuota + eksekusi).
      const identicalCalls = new Map<string, { count: number; content: string; note: string; ok: boolean; errorCode?: string; risk: string }>();
      // Temuan 6: check deadline + finalization buffer (4s for production runs)
      const finalizationBufferMs = deps.limits.runTimeoutMs >= 10_000 ? 4_000 : 0;
      const toolDeadlineBufferMs = deps.limits.runTimeoutMs >= 10_000 ? 2_000 : 0;

      const stepEnv = {
        db: deps.db,
        client: input.client,
        maxTokens: deps.limits.maxTokens,
        runId: input.runId,
        entryController: entry.controller,
        dispatcher: deps.dispatcher,
        logger: deps.logger,
        txCoordinator: deps.txCoordinator,
        maxSteps: deps.limits.maxSteps,
        maxToolCalls: deps.limits.maxToolCalls,
        runTimeoutMs: deps.limits.runTimeoutMs,
      };
      for (let step = 0; step < deps.limits.maxSteps; step++) {
        if (cancelledNow()) {
          counters.finalStatus = "cancelled";
          break;
        }
        await runAgentStep(stepEnv, {
          step,
          input,
          chatHistory,
          providerTools,
          catalog,
          greetingOnly,
          deadline,
          finalizationBufferMs,
          toolDeadlineBufferMs,
          toolCallCount,
          toolState: { identicalCalls, providerTools },
          emitSeq,
          counters,
          isCancelled: cancelledNow,
        });
        if (counters.finalStatus !== "completed") break;
      }

      await finalizeRun(deps, { runId: input.runId, conversationId: input.conversationId, modelLabel: input.client.modelLabel }, counters, emitSeq);
    } catch (err) {
      if (entry.cancelled) {
        counters.finalStatus = "cancelled";
        counters.failCode = "CANCELLED";
        counters.failMessage = "dibatalkan pengguna";
        await finalizeRun(deps, { runId: input.runId, conversationId: input.conversationId, modelLabel: input.client.modelLabel }, counters, emitSeq);
      } else {
        deps.logger.error("agent run crashed", { runId: input.runId, message: err instanceof Error ? err.message : String(err) });
        counters.finalStatus = "failed";
        counters.failCode = err instanceof AppError ? err.code : "INTERNAL_ERROR";
        counters.failMessage = err instanceof Error ? err.message : String(err);
        await finalizeRun(deps, { runId: input.runId, conversationId: input.conversationId, modelLabel: input.client.modelLabel }, counters, emitSeq);
      }
    } finally {
      activeRuns.delete(input.runId);
    }
    return { status: counters.finalStatus };
  }

  return { run, cancel, isCancelled, has: (runId: string) => activeRuns.has(runId) };
}

export type AgentLoop = ReturnType<typeof createAgentLoop>;
