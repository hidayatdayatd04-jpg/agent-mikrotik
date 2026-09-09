import type { Database } from "../db";
import { approveRequest, createRequest, rejectRequest } from "./approval/lifecycle";
import { executeApproval } from "./approval/execute";
import { getApproval, getOperationLog, listApprovals } from "./approval/queries";
import type { ApprovalStatus } from "./approval/types";

export type {
  ApprovalDTO,
  ApprovalOperation,
  ApprovalStatus,
  CreateApprovalInput,
  OperationLogDTO,
  RiskLevel,
} from "./approval/types";

export function createApprovalService(deps: {
  db: Database;
  executeTool?: (input: { userId: string; connectionId: string; fqName: string; args: unknown }) => Promise<{ ok: boolean; output: string; errorCode?: string }>;
  backups?: { createSnapshot: (userId: string, connectionId: string, opts?: any) => Promise<any> };
  notifications?: { create: (input: any) => Promise<any> };
}) {
  const { db } = deps;

  return {
    createRequest: (input: Parameters<typeof createRequest>[1]) => createRequest({ db }, input),
    approve: (userId: string, approvalId: string) => approveRequest({ db }, userId, approvalId),
    reject: (userId: string, approvalId: string, reason?: string) => rejectRequest({ db }, userId, approvalId, reason),
    execute: (
      userId: string,
      approvalId: string,
      executeTool: (input: { userId: string; connectionId: string; fqName: string; args: unknown }) => Promise<{ ok: boolean; output: string; errorCode?: string }>,
    ) => executeApproval({ db, backups: deps.backups, notifications: deps.notifications }, userId, approvalId, executeTool),
    get: (userId: string, approvalId: string) => getApproval(db, userId, approvalId),
    list: (userId: string, opts?: { status?: ApprovalStatus; connectionId?: string; conversationId?: string; limit?: number }) =>
      listApprovals(db, userId, opts),
    getOperationLog: (userId: string, approvalId: string) => getOperationLog(db, userId, approvalId),
  };
}

export type ApprovalService = ReturnType<typeof createApprovalService>;
