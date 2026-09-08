import type { ChatMessage, ChatToolCall } from "../chat-client";
import type { NormalizedTool } from "../../policies/normalize";
import type { EmitFn, RunCounters } from "./context";
import { executeSingleTool, type SingleToolEnv, type SingleToolState } from "./single-tool";
import { parseToolArgs } from "./tool-args";
import type { StartRunInput } from "./types";

export interface StepToolsArgs {
  stepToolCalls: ChatToolCall[];
  catalog: NormalizedTool[];
  chatHistory: ChatMessage[];
  toolCallCount: Map<string, number>;
  deadline: number;
  toolDeadlineBufferMs: number;
  maxToolCalls: number;
  isCancelled: () => boolean;
}

/** Eksekusi seluruh tool call pada satu step (budget, dedup, argumen, loop). */
export async function runStepTools(
  env: SingleToolEnv,
  input: StartRunInput,
  args: StepToolsArgs,
  emitSeq: EmitFn,
  counters: RunCounters,
  state: SingleToolState,
): Promise<void> {
  const { stepToolCalls, catalog, chatHistory, toolCallCount } = args;
  for (const [i, call] of stepToolCalls.entries()) {
    if (args.isCancelled()) {
      counters.finalStatus = "cancelled";
      break;
    }
    // Temuan 6: check deadline before each tool execution
    if (Date.now() > args.deadline - args.toolDeadlineBufferMs) {
      counters.finalStatus = "failed";
      counters.failCode = "RUN_TIMEOUT";
      counters.failMessage = "Deadline tercapai sebelum tool berikutnya dapat dieksekusi.";
      break;
    }
    if (counters.toolCallsTotal >= args.maxToolCalls) {
      counters.finalStatus = "failed";
      counters.failCode = "TOOL_CALL_BUDGET";
      counters.failMessage = `Batas ${args.maxToolCalls} tool call per run tercapai.`;
      break;
    }
    counters.toolCallsTotal += 1;
    if (toolCallCount.has(call.id)) {
      // dedup repeated ids: still answer with a tool message to keep
      // the provider's required assistant(tool_calls) → tool alternation
      chatHistory.push({ role: "tool", content: JSON.stringify({ error: "DUPLICATE_CALL", message: "Panggilan duplikat diabaikan." }), toolCallId: call.id });
      continue;
    }
    toolCallCount.set(call.id, 1);
    // WAIT for complete arguments: parse JSON; incomplete → typed error result, never executed
    const parsed = await parseToolArgs(env.db, input, call, chatHistory);
    if (!parsed.ok) continue;
    // map provider tool name back to fqName (dots replaced by _ in provider space)
    const fq = catalog.find((t) => t.fqName.replace(/[^A-Za-z0-9_-]/g, "_") === call.name)?.fqName ?? call.name;
    await executeSingleTool(env, input, call, fq, parsed.args, catalog, i, emitSeq, counters, state, chatHistory);
    if (counters.finalStatus !== "completed") break;
  }
}
