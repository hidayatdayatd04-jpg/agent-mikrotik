import { and, eq } from "drizzle-orm";
import type { Database } from "../../db";
import { approvalRequests, auditEvents } from "../../db/schema";
import { AppError } from "../../lib/errors";
import { hashOperations, toDTO, type ApprovalDTO, type ApprovalOperation } from "./types";
import { runApprovalOperations, type OperationCtx } from "./operations";
import { verifyApprovalExecution } from "./verify";

export interface ExecuteCtx {
  db: Database;
  backups?: { createSnapshot: (userId: string, connectionId: string, opts?: any) => Promise<any> };
  notifications?: { create: (input: any) => Promise<any> };
}

/** Eksekusi approval: guard hash + CAS + backup + operasi + verifikasi + status akhir. */
export async function executeApproval(
  ctx: ExecuteCtx,
  userId: string,
  approvalId: string,
  executeTool: OperationCtx["executeTool"],
): Promise<ApprovalDTO> {
  const { db } = ctx;
  const [row] = await db.select().from(approvalRequests)
    .where(and(eq(approvalRequests.id, approvalId), eq(approvalRequests.userId, userId)))
    .limit(1);

  if (!row) throw new AppError("NOT_FOUND", "Approval request tidak ditemukan.", 404);
  if (row.status !== "approved") throw new AppError("CONFLICT", `Hanya approval berstatus approved yang dapat dieksekusi. Status saat ini: ${row.status}.`, 409);
  if (row.expiresAt < new Date()) {
    await db.update(approvalRequests).set({ status: "expired", updatedAt: new Date() }).where(eq(approvalRequests.id, approvalId));
    throw new AppError("CONFLICT", "Approval sudah kedaluwarsa.", 409);
  }

  // Verify operations hash hasn't been tampered with
  const operations = row.operations as ApprovalOperation[];
  const currentHash = hashOperations(operations);
  if (currentHash !== row.approvedOperationsHash) {
    throw new AppError("CONFLICT", "Operasi telah berubah setelah approval. Perlu persetujuan ulang.", 409);
  }

  // Prevent double execution: CAS update
  const updateResult = db.$client.prepare(
    "UPDATE approval_requests SET status = 'executed', executed_at = ?, updated_at = ? WHERE id = ? AND status = 'approved'"
  ).run(Date.now(), Date.now(), approvalId);

  if ((updateResult as { changes: number }).changes === 0) {
    throw new AppError("CONFLICT", "Approval sudah dieksekusi atau status berubah.", 409);
  }

  // Pre-change backup
  if (ctx.backups) {
    try {
      const pre = await ctx.backups.createSnapshot(userId, row.connectionId, {
        name: `Pre-Approval #${approvalId.slice(0, 8)}`,
        createdBy: "system",
      });
      await db.update(approvalRequests).set({ preBackupId: pre.id }).where(eq(approvalRequests.id, approvalId));
    } catch {
      // Safe fallback if router export is unavailable
    }
  }

  const opCtx: OperationCtx = { db, executeTool, userId, connectionId: row.connectionId, approvalId };
  const { results, allOk } = await runApprovalOperations(opCtx, operations);

  // Phase 3: Post-execution Verification on Router
  const verificationResults = allOk ? await verifyApprovalExecution(opCtx, { operations, affectedObjects: row.affectedObjects }) : [];

  // Update final status
  const finalStatus = allOk ? "executed" : "failed";
  await db.update(approvalRequests).set({
    status: finalStatus,
    executionResult: {
      results,
      allOk,
      verification: {
        verified: verificationResults.length > 0 && verificationResults.every((v) => v.ok),
        results: verificationResults,
      },
    },
    executionError: allOk ? null : "Beberapa operasi gagal. Lihat log detail.",
    updatedAt: new Date(),
  }).where(eq(approvalRequests.id, approvalId));

  await db.insert(auditEvents).values({
    userId, action: `approval.${finalStatus}`, connectionId: row.connectionId,
    metadata: { approvalId, allOk, operationCount: operations.length, failedCount: results.filter((r) => !r.ok).length },
  });

  // Send notification
  if (ctx.notifications) {
    void ctx.notifications.create({
      userId,
      connectionId: row.connectionId,
      type: allOk ? "success" : "critical",
      category: "config",
      title: allOk ? "Perubahan Disetujui Berhasil Diterapkan" : "Eksekusi Perubahan Gagal",
      message: `Persetujuan "${row.summary}" (${operations.length} langkah) selesai dieksekusi.${allOk ? "" : " Terdapat langkah yang gagal."}`,
    }).catch(() => {});
  }

  const [updated] = await db.select().from(approvalRequests).where(eq(approvalRequests.id, approvalId)).limit(1);
  return toDTO(updated!);
}
