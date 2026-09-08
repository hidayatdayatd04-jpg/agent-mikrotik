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

/** Satu iterasi step: stream → finish/final → eksekusi tools. */
export async function runAgentStep(env: StepEnv, args: StepArgs): Promise<void> {
  const { counters: c } = args;
  const streamed = await streamStepTurn(env, {
    chatHistory: args.chatHistory,
    providerTools: args.providerTools,
    greetingOnly: args.greetingOnly,
    deadline: args.deadline,
    finalizationBufferMs: args.finalizationBufferMs,
    emitSeq: args.emitSeq,
    counters: c,
  });
  if (streamed.status === "timeout") return;
  // Temuan 6: check deadline after stream completes (clock shifted or slow provider)
  if (Date.now() >= args.deadline) {
    c.finalStatus = "failed";
    c.failCode = "RUN_TIMEOUT";
    c.failMessage = "Deadline tercapai saat respons provider selesai.";
    return;
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
  if (finished.action !== "tools") return;
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
}
