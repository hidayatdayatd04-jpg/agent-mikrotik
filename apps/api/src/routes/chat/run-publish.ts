import type { RunEvent } from "../../agent/loop";
import { recordActivity } from "../../services/activity";
import type { ChatCtx } from "./types";

/** Persist aktivitas + publish event hub untuk satu background run. */
export function createRunPublisher(ctx: ChatCtx, runId: string, conversationId: string, getTxId: () => string | null) {
  const { deps } = ctx;
  let eventSeq = 0;
  const persist = (type: string, actor: "user" | "ai" | "system", activityId: string, parentId: string | null, payload: Record<string, unknown>) => {
    void recordActivity(deps.db, {
      conversationId,
      runId,
      activityId,
      parentId,
      type,
      actor,
      payload,
    }).catch((err) => deps.logger.warn("activity persist failed", { message: err instanceof Error ? err.message : String(err) }));
  };
  const publish = (event: RunEvent) => {
    deps.hub.publish(event.runId, { ...event, seq: ++eventSeq });
    const p = (event.payload ?? {}) as Record<string, unknown>;
    if (event.type === "run.started") persist("run.started", "system", `run-${runId}`, null, { conversationId });
    else if (event.type === "tool.started")
      persist("tool.started", "ai", String(p.callId ?? `tool-${eventSeq}`), `run-${runId}`, {
        tool: String(p.name ?? "tool"),
        callId: String(p.callId ?? ""),
      });
    else if (event.type === "tool.completed" || event.type === "tool.failed")
      persist(event.type === "tool.completed" ? "tool.completed" : "tool.failed", "ai", String(p.callId ?? `tool-${eventSeq}`), `run-${runId}`, {
        tool: String(p.name ?? "tool"),
        callId: String(p.callId ?? ""),
        summary: String(p.summary ?? p.message ?? "").slice(0, 2000),
        code: String(p.code ?? ""),
        durationMs: typeof p.durationMs === "number" ? p.durationMs : null,
        args: typeof p.args === "string" ? p.args.slice(0, 500) : null,
        research: p.research && typeof p.research === "object" ? (p.research as Record<string, unknown>) : null,
      });
    else if (event.type === "transaction.updated")
      persist("transaction.updated", "system", `tx-${String(p.transactionId ?? getTxId() ?? "unknown")}`, `run-${runId}`, {
        state: String(p.state ?? ""),
        actions: Number(p.actions ?? 0),
      });
  };
  return { publish };
}

export type RunPublisher = ReturnType<typeof createRunPublisher>;
