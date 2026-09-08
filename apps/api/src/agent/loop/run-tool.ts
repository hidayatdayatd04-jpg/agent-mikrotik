import { toolExecutions } from "../../db/schema";
import { redactObject, redactText } from "../../lib/redaction";
import type { ChatToolCall } from "../chat-client";
import { CONNECTION_CHECK_FQ } from "./connection";
import type { EmitFn, ToolMsg } from "./context";
import { dispatchToolCall, type ToolEnv } from "./dispatch";
import { runConnectionProbe } from "./probe";
import { findDirectToolsForQuery } from "./ranking";
import type { NormalizedTool } from "../../policies/normalize";
import { extractResearchPayload } from "./research";
import { toolFailGuidance } from "./guidance";
import { MAX_TOOL_RESULT_CHARS, type StartRunInput } from "./types";

/** Execute one dispatched tool with redaction + persistence. Returns SSE events. */
export async function runTool(
  env: ToolEnv,
  input: StartRunInput,
  call: ChatToolCall,
  fqName: string,
  args: unknown,
  catalog: NormalizedTool[],
  emit: EmitFn,
  toolIndex: number,
): Promise<ToolMsg> {
  const started = Date.now();
  await emit({ type: "tool.started", payload: { callId: call.id, name: fqName, index: toolIndex } });
  // Backend-owned probe: answered from live server rows, no dispatcher needed
  // (read-only metadata, no secrets, ownership-checked inside).
  if (fqName === CONNECTION_CHECK_FQ) {
    return runConnectionProbe(env.db, input, call, fqName, started, emit, toolIndex);
  }

  const dispatched = await dispatchToolCall(env, input, call, fqName, args, catalog, emit, started);
  if (!dispatched.allowed) return dispatched.toolMsg;
  const decisionTool = dispatched.tool;

  let result: { ok: boolean; output: string; errorCode?: string };
  // Discovery yang tidak perlu dialihkan ke tool langsung yang sudah tersedia
  // (tanpa eksekusi pencarian): hemat round-trip, tuntun model ke pembacaan langsung.
  const isDiscovery = fqName.includes("find_tools") || fqName.includes("routeros_search");
  const directRedirect = isDiscovery
    ? findDirectToolsForQuery(
        (args as Record<string, unknown> | null)?.query ?? (args as Record<string, unknown> | null)?.search,
        catalog,
      )
    : [];
  if (directRedirect.length > 0) {
    const names = directRedirect.map((t) => t.fqName).join(", ");
    const redirectText =
      `Pencarian tidak diperlukan — kemampuan ini sudah tersedia langsung: ${names}. ` +
      `Panggil salah satu tool tersebut, bukan find_tools lagi.`;
    const durationMs = Date.now() - started;
    await env.db
      .insert(toolExecutions)
      .values({
        runId: input.runId,
        toolCallId: call.id,
        toolName: fqName,
        risk: decisionTool.risk,
        sanitizedInput: redactObject(args ?? {}),
        resultSummary: redirectText.slice(0, 500),
        status: "completed",
        errorCode: null,
        durationMs,
      })
      .onConflictDoNothing();
    await emit({ type: "tool.completed", payload: { callId: call.id, name: fqName, summary: redirectText.slice(0, 1500), durationMs, index: toolIndex, redirected: true } });
    return {
      role: "tool",
      content: JSON.stringify({ ok: true, output: redirectText, directTools: directRedirect.map((t) => t.fqName) }),
      toolCallId: call.id,
      note: `Discovery dialihkan ke tool langsung: ${names}`.slice(0, 500),
      ok: true,
      risk: decisionTool.risk,
    };
  }
  try {
    result = await input.executeTool({
      fqName,
      args,
      retryRead: decisionTool.risk === "read" && input.policy.transactionState !== "active",
    });
  } catch (err) {
    result = { ok: false, output: err instanceof Error ? err.message : String(err), errorCode: "INTERNAL_ERROR" };
  }
  const isTruncated = result.output.length > MAX_TOOL_RESULT_CHARS;
  const truncatedText = isTruncated
    ? result.output.slice(0, MAX_TOOL_RESULT_CHARS) + `\n\n[Output terpotong: menampilkan ${MAX_TOOL_RESULT_CHARS} karakter pertama]`
    : result.output;
  let redacted = redactText(truncatedText);
  if (!redacted.trim()) {
    redacted = "(Hasil kosong / 0 baris data)";
  }
  await env.db
    .insert(toolExecutions)
    .values({
      runId: input.runId,
      toolCallId: call.id,
      toolName: fqName,
      risk: decisionTool.risk,
      sanitizedInput: redactObject(args ?? {}),
      resultSummary: redacted.slice(0, 500),
      status: result.ok ? "completed" : "failed",
      errorCode: result.errorCode ?? null,
      durationMs: Date.now() - started,
    })
    .onConflictDoNothing();
  const durationMs = Date.now() - started;
  const argsPreview = JSON.stringify(redactObject(args ?? {})).slice(0, 500);
  const research = extractResearchPayload(fqName, result);
  if (result.ok) {
    await emit({ type: "tool.completed", payload: { callId: call.id, name: fqName, summary: redacted.slice(0, 1500), args: argsPreview, durationMs, index: toolIndex, ...(research ? { research } : {}) } });
  } else {
    await emit({ type: "tool.failed", payload: { callId: call.id, name: fqName, code: result.errorCode ?? "TOOL_FAILED", summary: redacted.slice(0, 1500), args: argsPreview, durationMs } });
  }
  // For failed tool results, add guidance so AI doesn't silently swallow errors.
  if (!result.ok) {
    const guidance = toolFailGuidance(result.errorCode ?? "TOOL_FAILED", fqName);
    return {
      role: "tool",
      content: JSON.stringify({ ok: false, error: result.errorCode ?? "TOOL_FAILED", output: redacted, guidance }),
      toolCallId: call.id,
      note: `Tool ${fqName} gagal (${result.errorCode ?? "TOOL_FAILED"}): ${redacted.slice(0, 400)}`,
      ok: false,
      errorCode: result.errorCode ?? "TOOL_FAILED",
      risk: decisionTool.risk,
    };
  }
  return {
    role: "tool",
    content: JSON.stringify({ ok: true, output: redacted }),
    toolCallId: call.id,
    note: `Tool ${fqName} berhasil: ${redacted.slice(0, 400)}`,
    ok: true,
    risk: decisionTool.risk,
  };
}
