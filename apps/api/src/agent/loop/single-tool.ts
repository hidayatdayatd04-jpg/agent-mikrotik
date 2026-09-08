import type { Logger } from "../../lib/logger";
import type { ChatMessage, ChatToolCall, ChatToolDefinition } from "../chat-client";
import type { NormalizedTool } from "../../policies/normalize";
import type { TransactionCoordinator } from "../../transactions/coordinator";
import { CONNECTION_CHECK_FQ } from "./connection";
import type { EmitFn, RunCounters, ToolMsg } from "./context";
import { MAX_PROVIDER_TOOLS } from "./ranking";
import { canonicalKey } from "./ranking";
import { runTool } from "./run-tool";
import type { ToolEnv } from "./dispatch";
import { toProviderTools } from "./provider-tools";
import { recordTxAction } from "./tx-record";
import type { StartRunInput } from "./types";

export interface SingleToolEnv extends ToolEnv {
  logger: Logger;
  txCoordinator: TransactionCoordinator;
}

export interface SingleToolState {
  identicalCalls: Map<string, { count: number; content: string; note: string; ok: boolean; errorCode?: string; risk: string }>;
  providerTools: ChatToolDefinition[];
}

/**
 * Satu pemanggilan tool: guard anti-loop, cache ulangan identik, eksekusi,
 * injeksi skema discovery, invalidasi cache baca, pencatatan transaksi.
 */
export async function executeSingleTool(
  env: SingleToolEnv,
  input: StartRunInput,
  call: ChatToolCall,
  fq: string,
  args: unknown,
  catalog: NormalizedTool[],
  toolIndex: number,
  emitSeq: EmitFn,
  counters: RunCounters,
  state: SingleToolState,
  chatHistory: ChatMessage[],
): Promise<void> {
  const { identicalCalls, providerTools } = state;
  // Guard anti-loop: (tool + argumen kanonis) identik yang ketiga
  // kalinya tanpa kemajuan → hentikan run, jangan eksekusi ulang.
  const loopKey = canonicalKey(fq, args);
  const seen = identicalCalls.get(loopKey);
  if (seen && seen.count >= 2) {
    counters.finalStatus = "failed";
    counters.failCode = "TOOL_LOOP_DETECTED";
    counters.failMessage =
      `Model meminta tool "${fq}" dengan argumen identik berulang kali tanpa kemajuan. ` +
      `Hasil terakhir yang tersimpan: ${seen.note.slice(0, 400)}`;
    chatHistory.push({
      role: "tool",
      content: JSON.stringify({ error: "TOOL_LOOP_DETECTED", message: counters.failMessage }),
      toolCallId: call.id,
    });
    return;
  }
  let toolMsg: ToolMsg;
  if (seen && fq !== CONNECTION_CHECK_FQ) {
    // Pengulangan identik ke-2: pakai hasil cache, tanpa eksekusi ulang.
    seen.count += 1;
    await emitSeq({ type: "tool.started", payload: { callId: call.id, name: fq, index: toolIndex, cached: true } });
    if (seen.ok) {
      await emitSeq({ type: "tool.completed", payload: { callId: call.id, name: fq, summary: seen.note, durationMs: 0, index: toolIndex, cached: true } });
    } else {
      await emitSeq({ type: "tool.failed", payload: { callId: call.id, name: fq, code: seen.errorCode ?? "TOOL_FAILED", summary: seen.note, durationMs: 0, cached: true } });
    }
    toolMsg = { role: "tool", content: seen.content, toolCallId: call.id, note: seen.note, ok: seen.ok, errorCode: seen.errorCode, risk: seen.risk };
  } else {
    const toolStart = Date.now();
    toolMsg = await runTool(env, input, call, fq, args, catalog, emitSeq, toolIndex);
    counters.toolMsTotal += Date.now() - toolStart;
    identicalCalls.set(loopKey, { count: (seen?.count ?? 0) + 1, content: toolMsg.content, note: toolMsg.note, ok: toolMsg.ok, errorCode: toolMsg.errorCode, risk: toolMsg.risk });
    // Dynamic schema injection: if discovery tool was called, add discovered tools to providerTools
    if (fq.includes("find_tools") || fq.includes("routeros_search")) {
      const beforeCount = providerTools.length;
      for (const candidate of catalog) {
        // Temuan 7: word-boundary matching, not substring
        const namePattern = new RegExp(`\\b${candidate.rawName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
        if (namePattern.test(toolMsg.content) || toolMsg.content.includes(candidate.fqName)) {
          if (!providerTools.some((pt) => pt.function.name === candidate.fqName.replace(/[^A-Za-z0-9_-]/g, "_"))) {
            providerTools.push(...toProviderTools([candidate]));
          }
        }
      }
      // Temuan 7: enforce MAX_PROVIDER_TOOLS after injection
      if (providerTools.length > MAX_PROVIDER_TOOLS) {
        env.logger.info(`Discovery injection expanded tools from ${beforeCount} to ${providerTools.length}, trimming to ${MAX_PROVIDER_TOOLS}`);
        // Keep the first MAX_PROVIDER_TOOLS (already ranked by selectRelevantTools + new additions)
        providerTools.splice(MAX_PROVIDER_TOOLS);
      }
    }
    // Invalidate read caches if a mutation was executed
    if (toolMsg.ok && toolMsg.risk && toolMsg.risk !== "read") {
      for (const [k, v] of identicalCalls.entries()) {
        if (v.risk === "read") identicalCalls.delete(k);
      }
    }
  }
  counters.toolOutcomes.push({ fq, note: toolMsg.note.slice(0, 500), ok: toolMsg.ok, errorCode: toolMsg.errorCode });
  chatHistory.push(toolMsg);
  // transaction-aware tool calls: only record SUCCESSFUL MUTATION tools
  if (input.policy.mode === "write" && toolMsg.ok && toolMsg.risk !== "read") {
    await recordTxAction(env, input, emitSeq, chatHistory);
  }
}
