import { z } from "zod";

// ── Approval Types ────────────────────────────────────────────

export const ApprovalStatusSchema = z.enum([
  "pending",
  "approved",
  "rejected",
  "expired",
  "executed",
  "failed",
]);
export type ApprovalStatus = z.infer<typeof ApprovalStatusSchema>;

export const RiskLevelSchema = z.enum(["low", "medium", "high", "critical"]);
export type RiskLevel = z.infer<typeof RiskLevelSchema>;

export interface ApprovalOperation {
  command: string;
  description: string;
  risk: "read" | "write" | "destructive";
}

export const ApprovalDTOSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  connectionId: z.string().uuid(),
  runId: z.string().uuid().nullable(),
  conversationId: z.string().uuid().nullable(),
  status: ApprovalStatusSchema,
  summary: z.string(),
  operations: z.array(
    z.object({
      command: z.string(),
      description: z.string(),
      risk: z.enum(["read", "write", "destructive"]),
    }),
  ),
  riskLevel: RiskLevelSchema,
  impactDescription: z.string().nullable(),
  affectedObjects: z.array(z.string()).nullable(),
  operationsHash: z.string(),
  expiresAt: z.string().datetime(),
  approvedAt: z.string().datetime().nullable(),
  rejectedAt: z.string().datetime().nullable(),
  rejectedReason: z.string().nullable(),
  executedAt: z.string().datetime().nullable(),
  executionResult: z.record(z.string(), z.unknown()).nullable(),
  executionError: z.string().nullable(),
  preBackupId: z.string().nullable(),
  createdAt: z.string().datetime(),
});
export type ApprovalDTO = z.infer<typeof ApprovalDTOSchema>;

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
