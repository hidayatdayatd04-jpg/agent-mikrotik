import type { ChatMessage, ChatToolDefinition } from "../chat-client";
import type { NormalizedTool } from "../../policies/normalize";
import type { EmitFn, RunCounters } from "./context";
import { handleStepFinish } from "./finish";
import { runStepTools } from "./step-tools";
import type { SingleToolEnv, SingleToolState } from "./single-tool";
import { streamStepTurn, type StreamStepEnv } from "./stream";
import type { StartRunInput } from "./types";

export interface StepEnv extends StreamStepEnv, SingleToolEnv {
  maxSteps: number;
  maxToolCalls: number;
  runTimeoutMs: number;
}

export interface StepArgs {
  step: number;
  input: StartRunInput;
  chatHistory: ChatMessage[];
  providerTools: ChatToolDefinition[];
  catalog: NormalizedTool[];
  greetingOnly: boolean;
  deadline: number;
  finalizationBufferMs: number;
  toolDeadlineBufferMs: number;
  toolCallCount: Map<string, number>;
  toolState: SingleToolState;
  emitSeq: EmitFn;
  counters: RunCounters;
  isCancelled: () => boolean;
}

/**
 * Satu iterasi step: stream → finish/final → eksekusi tools.
 * Mengembalikan "end" bila run harus berhenti setelah step ini (jawaban
 * final sudah ditulis — penerus WAJIB break agar request berikutnya tidak
 * diawali history berujung assistant), "continue" bila loop berlanjut.
 */
export async function runAgentStep(env: StepEnv, args: StepArgs): Promise<"end" | "continue"> {
  const { counters: c } = args;
  // Invarian anti-400: provider (khususnya Gemini) menolak request yang
  // diakhiri giliran model. chatHistory tidak boleh berujung assistant
  // saat step dimulai — bila terjadi, gagalkan dengan diagnosis jelas
  // daripada membakar request yang pasti ditolak provider.
  const tail = args.chatHistory[args.chatHistory.length - 1];
  if (tail?.role === "assistant") {
    c.finalStatus = "failed";
    c.failCode = "INTERNAL_ERROR";
    c.failMessage = "Invariant loop dilanggar: riwayat chat berujung pesan assistant sebelum request baru.";
    return "end";
  }
  const streamed = await streamStepTurn(env, {
    chatHistory: args.chatHistory,
    providerTools: args.providerTools,
    greetingOnly: args.greetingOnly,
    deadline: args.deadline,
    finalizationBufferMs: args.finalizationBufferMs,
    emitSeq: args.emitSeq,
    counters: c,
  });
  if (streamed.status === "timeout") return "continue";
  // Temuan 6: check deadline after stream completes (clock shifted or slow provider)
  if (Date.now() >= args.deadline) {
    c.finalStatus = "failed";
    c.failCode = "RUN_TIMEOUT";
    c.failMessage = "Deadline tercapai saat respons provider selesai.";
    return "continue";
  }
  const finished = handleStepFinish(c, {
    stepText: streamed.stepText,
    stepToolCalls: streamed.stepToolCalls,
    stepFinishReason: streamed.stepFinishReason,
    step: args.step,
    greetingOnly: args.greetingOnly,
    providerToolsLength: args.providerTools.length,
    chatHistory: args.chatHistory,
  });
  if (finished.action === "next") return "continue";
  if (finished.action !== "tools") return "end";
  if (args.step === env.maxSteps - 1 && streamed.stepToolCalls.length > 0) {
    c.finalStatus = "failed";
    c.failCode = "STEP_LIMIT_REACHED";
    c.failMessage = `Batas ${env.maxSteps} langkah eksekusi tercapai sebelum selesai.`;
  }
  // assistant turn with tool calls — persist pair and execute each.
  // content "" (bukan null): endpoint OpenAI-compatible Gemini menolak
  // content null pada giliran tool_calls dengan 400 invalid argument.
  args.chatHistory.push({ role: "assistant", content: streamed.stepText, toolCalls: streamed.stepToolCalls });
  await runStepTools(env, args.input, {
    stepToolCalls: streamed.stepToolCalls,
    catalog: args.catalog,
    chatHistory: args.chatHistory,
    toolCallCount: args.toolCallCount,
    deadline: args.deadline,
    toolDeadlineBufferMs: args.toolDeadlineBufferMs,
    maxToolCalls: env.maxToolCalls,
    isCancelled: args.isCancelled,
  }, args.emitSeq, c, args.toolState);
  return "continue";
}
