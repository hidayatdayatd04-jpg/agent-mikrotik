import { and, desc, eq } from "drizzle-orm";
import type { Database } from "../../db";
import { approvalOperationLog, approvalRequests } from "../../db/schema";
import { toDTO, type ApprovalDTO, type ApprovalStatus, type OperationLogDTO } from "./types";

export async function getApproval(db: Database, userId: string, approvalId: string): Promise<ApprovalDTO | null> {
  const [row] = await db.select().from(approvalRequests)
    .where(and(eq(approvalRequests.id, approvalId), eq(approvalRequests.userId, userId)))
    .limit(1);
  return row ? toDTO(row) : null;
}

export async function listApprovals(db: Database, userId: string, opts: { status?: ApprovalStatus; connectionId?: string; conversationId?: string; limit?: number } = {}) {
  const conditions = [eq(approvalRequests.userId, userId)];
  if (opts.status) conditions.push(eq(approvalRequests.status, opts.status));
  if (opts.connectionId) conditions.push(eq(approvalRequests.connectionId, opts.connectionId));
  if (opts.conversationId) conditions.push(eq(approvalRequests.conversationId, opts.conversationId));

  const rows = await db.select().from(approvalRequests)
    .where(and(...conditions))
    .orderBy(desc(approvalRequests.createdAt))
    .limit(opts.limit ?? 50);
  return rows.map(toDTO);
}

export async function getOperationLog(db: Database, userId: string, approvalId: string): Promise<OperationLogDTO[]> {
  // Verify ownership
  const [row] = await db.select().from(approvalRequests)
    .where(and(eq(approvalRequests.id, approvalId), eq(approvalRequests.userId, userId)))
    .limit(1);
  if (!row) return [];

  const logs = await db.select().from(approvalOperationLog)
    .where(eq(approvalOperationLog.approvalId, approvalId))
    .orderBy(approvalOperationLog.seq);

  return logs.map((l) => ({
    id: l.id,
    seq: l.seq,
    command: l.command,
    status: l.status,
    output: l.output,
    errorMessage: l.errorMessage,
    durationMs: l.durationMs,
    executedAt: l.executedAt?.toISOString() ?? null,
  }));
}
