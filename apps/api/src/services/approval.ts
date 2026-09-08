import type { Database } from "../db";
import { approvalRequests, approvalOperationLog, auditEvents } from "../db/schema";
import { eq, and, desc } from "drizzle-orm";
import { createHash } from "node:crypto";
import { AppError } from "../lib/errors";
import { redactText } from "../lib/redaction";

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

function hashOperations(operations: ApprovalOperation[]): string {
  const canonical = JSON.stringify(operations.map((o) => ({ command: o.command, description: o.description, risk: o.risk })));
  return createHash("sha256").update(canonical).digest("hex");
}

export function createApprovalService(deps: {
  db: Database;
  executeTool?: (input: { userId: string; connectionId: string; fqName: string; args: unknown }) => Promise<{ ok: boolean; output: string; errorCode?: string }>;
  backups?: { createSnapshot: (userId: string, connectionId: string, opts?: any) => Promise<any> };
  notifications?: { create: (input: any) => Promise<any> };
}) {
  const { db } = deps;

  async function createRequest(input: CreateApprovalInput): Promise<ApprovalDTO> {
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

  async function approve(userId: string, approvalId: string): Promise<ApprovalDTO> {
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

  async function reject(userId: string, approvalId: string, reason?: string): Promise<ApprovalDTO> {
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

  async function execute(userId: string, approvalId: string, executeTool: (input: { userId: string; connectionId: string; fqName: string; args: unknown }) => Promise<{ ok: boolean; output: string; errorCode?: string }>): Promise<ApprovalDTO> {
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
    if (deps.backups) {
      try {
        const pre = await deps.backups.createSnapshot(userId, row.connectionId, {
          name: `Pre-Approval #${approvalId.slice(0, 8)}`,
          createdBy: "system",
        });
        await db.update(approvalRequests).set({ preBackupId: pre.id }).where(eq(approvalRequests.id, approvalId));
      } catch {
        // Safe fallback if router export is unavailable
      }
    }

    // Execute operations one by one
    const results: { seq: number; ok: boolean; output: string }[] = [];
    let allOk = true;

    for (let i = 0; i < operations.length; i++) {
      const op = operations[i]!;
      const started = Date.now();

      try {
        const res = await executeTool({
          userId,
          connectionId: row.connectionId,
          fqName: `mt:run_routeros_command`,
          args: { command: op.command },
        });

        const duration = Date.now() - started;
        await db.insert(approvalOperationLog).values({
          approvalId,
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
        await db.insert(approvalOperationLog).values({
          approvalId, seq: i, command: redactText(op.command),
          status: "failed", errorMessage: redactText(errMsg.slice(0, 1000)),
          durationMs: duration, executedAt: new Date(),
        });
        results.push({ seq: i, ok: false, output: redactText(errMsg.slice(0, 500)) });
        allOk = false;
      }
    }

    // Phase 3: Post-execution Verification on Router
    const verificationResults: { path: string; ok: boolean; output: string }[] = [];
    if (allOk) {
      const pathsToVerify = new Set<string>();
      if (Array.isArray(row.affectedObjects)) {
        for (const obj of row.affectedObjects as string[]) {
          const clean = String(obj).trim().replace(/\s+(print|detail|show|get)$/i, "");
          if (clean.startsWith("/")) pathsToVerify.add(clean);
        }
      }
      if (pathsToVerify.size === 0) {
        for (const op of operations) {
          const m = op.command.trim().match(/^(\/[a-z0-9_-]+(?:\s+[a-z0-9_-]+)*)\s+(?:add|set|remove|enable|disable)/i);
          if (m && m[1]) pathsToVerify.add(m[1]);
        }
      }

      let vIndex = 0;
      for (const targetPath of pathsToVerify) {
        const verifyCmd = `${targetPath} print`;
        const vStart = Date.now();
        try {
          const vRes = await executeTool({
            userId,
            connectionId: row.connectionId,
            fqName: "mt:run_routeros_command",
            args: { command: verifyCmd },
          });
          const vDuration = Date.now() - vStart;
          await db.insert(approvalOperationLog).values({
            approvalId,
            seq: operations.length + vIndex,
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
    }

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
    if (deps.notifications) {
      void deps.notifications.create({
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

  async function get(userId: string, approvalId: string): Promise<ApprovalDTO | null> {
    const [row] = await db.select().from(approvalRequests)
      .where(and(eq(approvalRequests.id, approvalId), eq(approvalRequests.userId, userId)))
      .limit(1);
    return row ? toDTO(row) : null;
  }

  async function list(userId: string, opts: { status?: ApprovalStatus; connectionId?: string; conversationId?: string; limit?: number } = {}) {
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

  async function getOperationLog(userId: string, approvalId: string): Promise<OperationLogDTO[]> {
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

  function toDTO(row: typeof approvalRequests.$inferSelect): ApprovalDTO {
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

  return { createRequest, approve, reject, execute, get, list, getOperationLog };
}

export type ApprovalService = ReturnType<typeof createApprovalService>;
