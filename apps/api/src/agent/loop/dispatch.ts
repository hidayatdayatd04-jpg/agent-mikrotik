import type { Database } from "../../db";
import { toolExecutions } from "../../db/schema";
import { AppError } from "../../lib/errors";
import { redactObject } from "../../lib/redaction";
import type { ChatToolCall } from "../chat-client";
import type { PolicyDispatcher } from "../../policies/dispatcher";
import type { NormalizedTool } from "../../policies/normalize";
import type { EmitFn, ToolMsg } from "./context";
import { policyDenialGuidance } from "./guidance";
import type { StartRunInput } from "./types";

export interface ToolEnv {
  db: Database;
  dispatcher: PolicyDispatcher;
}

export type DispatchOutcome =
  | { allowed: true; tool: NormalizedTool }
  | { allowed: false; toolMsg: ToolMsg };

/**
 * Deferred transaction opening + policy dispatch + pencatatan denial.
 * Mengembalikan tool terotorisasi, atau pesan tool penolakan typed.
 */
export async function dispatchToolCall(
  env: ToolEnv,
  input: StartRunInput,
  call: ChatToolCall,
  fqName: string,
  args: unknown,
  catalog: NormalizedTool[],
  emit: EmitFn,
  started: number,
): Promise<DispatchOutcome> {
  // Deferred transaction opening: only open Safe Mode when a mutation tool is dispatched
  const toolInCatalog = catalog.find((t) => t.fqName === fqName);
  if (input.policy.mode === "write" && input.policy.transactionState !== "active" && toolInCatalog && toolInCatalog.risk !== "read" && input.ensureTransaction) {
    const txRes = await input.ensureTransaction();
    if (txRes.ok && txRes.transactionId) {
      input.policy.transactionState = "active";
      await emit({
        type: "transaction.updated",
        payload: { transactionId: txRes.transactionId, state: "active", actions: 0 },
      });
    }
  }

  let decision: Awaited<ReturnType<PolicyDispatcher["check"]>>;
  try {
    decision = await env.dispatcher.check({
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
    await env.db
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
      allowed: false,
      toolMsg: {
        role: "tool",
        content: JSON.stringify({ error: code, message }),
        toolCallId: call.id,
        note: `Tool ${fqName} ditolak (${code}): ${message}`.slice(0, 500),
        ok: false,
        errorCode: code,
        risk: "unknown",
      },
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
    await env.db.insert(toolExecutions).values(record).onConflictDoNothing();
    await emit({ type: "tool.failed", payload: { callId: call.id, name: fqName, code: decision.code, message: decision.message, durationMs: Date.now() - started } });
    // Build actionable guidance so the AI model clearly reports the denial.
    const guidance = policyDenialGuidance(decision.code, fqName);
    return {
      allowed: false,
      toolMsg: {
        role: "tool",
        content: JSON.stringify({ ok: false, error: decision.code, message: decision.message, guidance }),
        toolCallId: call.id,
        note: `Tool ${fqName} ditolak (${decision.code}): ${decision.message}`.slice(0, 500),
        ok: false,
        errorCode: decision.code,
        risk: "unknown",
      },
    };
  }
  return { allowed: true, tool: decision.tool };
}
