import type { RunEvent } from "./types";

/** Emit tanpa seq/runId (dilengkapi oleh emitter per-run). */
export type EmitFn = (e: Omit<RunEvent, "seq" | "runId">) => Promise<void>;

/** Hasil tool tunggal untuk riwayat chat + telemetri run. */
export interface ToolMsg {
  role: "tool";
  content: string;
  toolCallId: string;
  note: string;
  ok: boolean;
  errorCode?: string;
  risk: string;
}

/** Seluruh state mutable per-run (pengganti closure `run()`). */
export interface RunCounters {
  seqCounter: number;
  timeline: RunEvent[];
  finalStatus: "completed" | "failed" | "cancelled";
  failCode: string | null;
  failMessage: string | null;
  assistantText: string;
  promptTokensTotal: number;
  completionTokensTotal: number;
  lastRequestPromptTokens: number;
  lastRequestCompletionTokens: number;
  aiRequests: number;
  toolCallsTotal: number;
  queueMsTotal: number;
  queueWaits: number;
  toolMsTotal: number;
  toolOutcomes: { fq: string; note: string; ok: boolean; errorCode?: string }[];
}

export function createRunCounters(): RunCounters {
  return {
    seqCounter: 0,
    timeline: [],
    finalStatus: "completed",
    failCode: null,
    failMessage: null,
    assistantText: "",
    promptTokensTotal: 0,
    completionTokensTotal: 0,
    lastRequestPromptTokens: 0,
    lastRequestCompletionTokens: 0,
    aiRequests: 0,
    toolCallsTotal: 0,
    queueMsTotal: 0,
    queueWaits: 0,
    toolMsTotal: 0,
    toolOutcomes: [],
  };
}

export function usageRecordOf(c: RunCounters, modelLabel: string) {
  return {
    promptTokens: c.promptTokensTotal,
    completionTokens: c.completionTokensTotal,
    lastRequestInputTokens: c.lastRequestPromptTokens,
    lastRequestOutputTokens: c.lastRequestCompletionTokens,
    aiRequests: c.aiRequests,
    toolCalls: c.toolCallsTotal,
    queueMsTotal: c.queueMsTotal,
    queueWaits: c.queueWaits,
    toolMsTotal: c.toolMsTotal,
    modelLabel,
    source: c.promptTokensTotal + c.completionTokensTotal > 0 ? "provider" : "local",
  };
}

/** Emitter ber-seq dengan merge delta (verbatim logika `emitSeq`). */
export function createEmitter(
  runId: string,
  emit: (e: RunEvent) => Promise<void>,
  counters: RunCounters,
): EmitFn {
  return async (e: Omit<RunEvent, "seq" | "runId">) => {
    counters.seqCounter += 1;
    const event: RunEvent = { ...e, runId, seq: counters.seqCounter };
    if (e.type === "message.delta" || e.type.startsWith("tool.")) {
      const previous = counters.timeline.at(-1);
      if (e.type === "message.delta" && previous?.type === "message.delta") {
        previous.payload = { text: String(previous.payload.text ?? "") + String(e.payload.text ?? "") };
      } else counters.timeline.push({ ...event, payload: { ...event.payload } });
    }
    await emit(event);
  };
}
