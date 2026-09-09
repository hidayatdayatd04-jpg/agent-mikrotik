import type { Database } from "../../db";
import { approvalOperationLog } from "../../db/schema";
import { redactText } from "../../lib/redaction";
import type { ApprovalOperation } from "./types";

export interface OperationCtx {
  db: Database;
  executeTool: (input: { userId: string; connectionId: string; fqName: string; args: unknown }) => Promise<{ ok: boolean; output: string; errorCode?: string }>;
  userId: string;
  connectionId: string;
  approvalId: string;
}

/** Eksekusi operasi satu per satu + pencatatan log per operasi. */
export async function runApprovalOperations(
  ctx: OperationCtx,
  operations: ApprovalOperation[],
): Promise<{ results: { seq: number; ok: boolean; output: string }[]; allOk: boolean }> {
  const results: { seq: number; ok: boolean; output: string }[] = [];
  let allOk = true;

  for (let i = 0; i < operations.length; i++) {
    const op = operations[i]!;
    const started = Date.now();

    try {
      const res = await ctx.executeTool({
        userId: ctx.userId,
        connectionId: ctx.connectionId,
        fqName: `mt:run_routeros_command`,
        args: { command: op.command },
      });

      const duration = Date.now() - started;
      await ctx.db.insert(approvalOperationLog).values({
        approvalId: ctx.approvalId,
        seq: i,
        command: redactText(op.command),
        status: res.ok ? "success" : "failed",
        output: res.output ? redactText(res.output.slice(0, 4000)) : null,
        errorMessage: res.ok ? null : redactText(res.output.slice(0, 1000)),
        durationMs: duration,
        executedAt: new Date(),
      });

      results.push({ seq: i, ok: res.ok, output: redactText(res.output.slice(0, 1000)) });
      if (!res.ok) allOk = false;
    } catch (err) {
      const duration = Date.now() - started;
      const errMsg = err instanceof Error ? err.message : String(err);
      await ctx.db.insert(approvalOperationLog).values({
        approvalId: ctx.approvalId, seq: i, command: redactText(op.command),
        status: "failed", errorMessage: redactText(errMsg.slice(0, 1000)),
        durationMs: duration, executedAt: new Date(),
      });
      results.push({ seq: i, ok: false, output: redactText(errMsg.slice(0, 500)) });
      allOk = false;
    }
  }
  return { results, allOk };
}
