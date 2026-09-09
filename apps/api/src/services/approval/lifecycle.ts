import { and, eq } from "drizzle-orm";
import type { Database } from "../../db";
import { approvalRequests, auditEvents } from "../../db/schema";
import { AppError } from "../../lib/errors";
import { redactText } from "../../lib/redaction";
import { hashOperations, toDTO, type ApprovalDTO, type CreateApprovalInput } from "./types";

export interface LifecycleCtx {
  db: Database;
}

export async function createRequest(ctx: LifecycleCtx, input: CreateApprovalInput): Promise<ApprovalDTO> {
  const { db } = ctx;
  const opsHash = hashOperations(input.operations);
  const expiresAt = new Date(Date.now() + (input.expiresInMs ?? 15 * 60 * 1000));

  const [row] = await db.insert(approvalRequests).values({
    userId: input.userId,
    connectionId: input.connectionId,
    runId: input.runId ?? null,
    conversationId: input.conversationId ?? null,
    summary: redactText(input.summary),
    operations: input.operations.map((o) => ({ ...o, command: redactText(o.command), description: redactText(o.description) })),
    riskLevel: input.riskLevel,
    impactDescription: input.impactDescription ? redactText(input.impactDescription) : null,
    affectedObjects: input.affectedObjects ?? null,
    operationsHash: opsHash,
    expiresAt,
    status: "pending",
  }).returning();

  // Audit
  await db.insert(auditEvents).values({
    userId: input.userId,
    action: "approval.created",
    connectionId: input.connectionId,
    runId: input.runId ?? null,
    metadata: { approvalId: row!.id, riskLevel: input.riskLevel, operationCount: input.operations.length },
  });

  return toDTO(row!);
}

export async function approveRequest(ctx: LifecycleCtx, userId: string, approvalId: string): Promise<ApprovalDTO> {
  const { db } = ctx;
  const [row] = await db.select().from(approvalRequests)
    .where(and(eq(approvalRequests.id, approvalId), eq(approvalRequests.userId, userId)))
    .limit(1);

  if (!row) throw new AppError("NOT_FOUND", "Approval request tidak ditemukan.", 404);
  if (row.status !== "pending") throw new AppError("CONFLICT", `Approval sudah berstatus: ${row.status}.`, 409);
  if (row.expiresAt < new Date()) {
    await db.update(approvalRequests).set({ status: "expired", updatedAt: new Date() }).where(eq(approvalRequests.id, approvalId));
    throw new AppError("CONFLICT", "Approval sudah kedaluwarsa.", 409);
  }

  await db.update(approvalRequests).set({
    status: "approved",
    approvedAt: new Date(),
    approvedOperationsHash: row.operationsHash,
    updatedAt: new Date(),
  }).where(and(eq(approvalRequests.id, approvalId), eq(approvalRequests.status, "pending")));

  await db.insert(auditEvents).values({
    userId, action: "approval.approved", connectionId: row.connectionId,
    metadata: { approvalId, riskLevel: row.riskLevel },
  });

  const [updated] = await db.select().from(approvalRequests).where(eq(approvalRequests.id, approvalId)).limit(1);
  return toDTO(updated!);
}

export async function rejectRequest(ctx: LifecycleCtx, userId: string, approvalId: string, reason?: string): Promise<ApprovalDTO> {
  const { db } = ctx;
  const [row] = await db.select().from(approvalRequests)
    .where(and(eq(approvalRequests.id, approvalId), eq(approvalRequests.userId, userId)))
    .limit(1);

  if (!row) throw new AppError("NOT_FOUND", "Approval request tidak ditemukan.", 404);
  if (row.status !== "pending") throw new AppError("CONFLICT", `Approval sudah berstatus: ${row.status}.`, 409);

  await db.update(approvalRequests).set({
    status: "rejected",
    rejectedAt: new Date(),
    rejectedReason: reason ? redactText(reason) : null,
    updatedAt: new Date(),
  }).where(eq(approvalRequests.id, approvalId));

  await db.insert(auditEvents).values({
    userId, action: "approval.rejected", connectionId: row.connectionId,
    metadata: { approvalId, reason: reason ? redactText(reason) : null },
  });

  const [updated] = await db.select().from(approvalRequests).where(eq(approvalRequests.id, approvalId)).limit(1);
  return toDTO(updated!);
}
