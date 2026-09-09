import { approvalOperationLog } from "../../db/schema";
import { redactText } from "../../lib/redaction";
import type { ApprovalOperation } from "./types";
import type { OperationCtx } from "./operations";

/** Phase 3: Post-execution Verification on Router (baca ulang path terdampak). */
export async function verifyApprovalExecution(
  ctx: OperationCtx,
  args: { operations: ApprovalOperation[]; affectedObjects: unknown },
): Promise<{ path: string; ok: boolean; output: string }[]> {
  const verificationResults: { path: string; ok: boolean; output: string }[] = [];
  const pathsToVerify = new Set<string>();
  if (Array.isArray(args.affectedObjects)) {
    for (const obj of args.affectedObjects as string[]) {
      const clean = String(obj).trim().replace(/\s+(print|detail|show|get)$/i, "");
      if (clean.startsWith("/")) pathsToVerify.add(clean);
    }
  }
  if (pathsToVerify.size === 0) {
    for (const op of args.operations) {
      const m = op.command.trim().match(/^(\/[a-z0-9_-]+(?:\s+[a-z0-9_-]+)*)\s+(?:add|set|remove|enable|disable)/i);
      if (m && m[1]) pathsToVerify.add(m[1]);
    }
  }

  let vIndex = 0;
  for (const targetPath of pathsToVerify) {
    const verifyCmd = `${targetPath} print`;
    const vStart = Date.now();
    try {
      const vRes = await ctx.executeTool({
        userId: ctx.userId,
        connectionId: ctx.connectionId,
        fqName: "mt:run_routeros_command",
        args: { command: verifyCmd },
      });
      const vDuration = Date.now() - vStart;
      await ctx.db.insert(approvalOperationLog).values({
        approvalId: ctx.approvalId,
        seq: args.operations.length + vIndex,
        command: `[VERIFIKASI] ${verifyCmd}`,
        status: vRes.ok ? "success" : "failed",
        output: vRes.output ? redactText(vRes.output.slice(0, 4000)) : null,
        durationMs: vDuration,
        executedAt: new Date(),
      });
      verificationResults.push({
        path: targetPath,
        ok: vRes.ok,
        output: redactText(vRes.output ? vRes.output.slice(0, 1500) : ""),
      });
      vIndex++;
    } catch {
      // verification read non-fatal
    }
  }
  return verificationResults;
}
