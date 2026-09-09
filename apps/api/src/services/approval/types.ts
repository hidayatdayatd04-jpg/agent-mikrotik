import { createHash } from "node:crypto";
import type { approvalRequests } from "../../db/schema";

export type ApprovalStatus = "pending" | "approved" | "rejected" | "expired" | "executed" | "failed";
export type RiskLevel = "low" | "medium" | "high" | "critical";

export interface ApprovalOperation {
  command: string;
  description: string;
  risk: "read" | "write" | "destructive";
}

export interface CreateApprovalInput {
  userId: string;
  connectionId: string;
  runId?: string | null;
  conversationId?: string | null;
  summary: string;
  operations: ApprovalOperation[];
  riskLevel: RiskLevel;
  impactDescription?: string;
  affectedObjects?: string[];
  expiresInMs?: number; // default 15 min
}

export interface ApprovalDTO {
  id: string;
  userId: string;
  connectionId: string;
  runId: string | null;
  conversationId: string | null;
  status: ApprovalStatus;
  summary: string;
  operations: ApprovalOperation[];
  riskLevel: RiskLevel;
  impactDescription: string | null;
  affectedObjects: string[] | null;
  operationsHash: string;
  expiresAt: string;
  approvedAt: string | null;
  rejectedAt: string | null;
  rejectedReason: string | null;
  executedAt: string | null;
  executionResult: Record<string, unknown> | null;
  executionError: string | null;
  preBackupId: string | null;
  createdAt: string;
}

export interface OperationLogDTO {
  id: string;
  seq: number;
  command: string;
  status: string;
  output: string | null;
  errorMessage: string | null;
  durationMs: number | null;
  executedAt: string | null;
}

export function hashOperations(operations: ApprovalOperation[]): string {
  const canonical = JSON.stringify(operations.map((o) => ({ command: o.command, description: o.description, risk: o.risk })));
  return createHash("sha256").update(canonical).digest("hex");
}

export function toDTO(row: typeof approvalRequests.$inferSelect): ApprovalDTO {
  return {
    id: row.id,
    userId: row.userId,
    connectionId: row.connectionId,
    runId: row.runId,
    conversationId: row.conversationId,
    status: row.status as ApprovalStatus,
    summary: row.summary,
    operations: row.operations as ApprovalOperation[],
    riskLevel: row.riskLevel as RiskLevel,
    impactDescription: row.impactDescription,
    affectedObjects: row.affectedObjects as string[] | null,
    operationsHash: row.operationsHash,
    expiresAt: row.expiresAt.toISOString(),
    approvedAt: row.approvedAt?.toISOString() ?? null,
    rejectedAt: row.rejectedAt?.toISOString() ?? null,
    rejectedReason: row.rejectedReason,
    executedAt: row.executedAt?.toISOString() ?? null,
    executionResult: row.executionResult as Record<string, unknown> | null,
    executionError: row.executionError,
    preBackupId: row.preBackupId,
    createdAt: row.createdAt.toISOString(),
  };
}
