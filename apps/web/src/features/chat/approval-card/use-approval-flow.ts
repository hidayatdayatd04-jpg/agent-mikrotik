import { useState, useEffect } from "react";
import { toast } from "sonner";
import type { ApprovalSpec } from "../approval-card";
import { useCreateApproval, useApproveRequest, useExecuteApproval, useApprovalLog, useApprovals } from "../../approvals/approval-hooks";

export type ApprovalStatus = "idle" | "in_progress" | "executed" | "failed" | "rejected";

export function useApprovalFlow(
  spec: ApprovalSpec,
  opts: { activeConnectionId?: string | null; conversationId?: string | null; onRejected?: (summary: string) => void },
) {
  const [status, setStatus] = useState<ApprovalStatus>("idle");
  const [approvalId, setApprovalId] = useState<string | null>(spec.id || null);
  const [executionError, setExecutionError] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isToolExpanded, setIsToolExpanded] = useState(false);
  const [showLog, setShowLog] = useState(true);
  const [showDiff, setShowDiff] = useState(false);
  const [serverVerification, setServerVerification] = useState<{
    toolLabel?: string;
    narrative?: string;
    durationMs?: number;
    command?: string;
    output?: string;
  } | null>(null);

  const createApproval = useCreateApproval();
  const approveMutation = useApproveRequest();
  const executeMutation = useExecuteApproval();
  const { data: logs } = useApprovalLog(approvalId);

  // Restore server approval state if already created or executed in this conversation
  const { data: existingApprovals } = useApprovals({
    connectionId: opts.activeConnectionId ?? undefined,
    conversationId: opts.conversationId ?? undefined,
  });

  useEffect(() => {
    if (existingApprovals && status === "idle") {
      const match = existingApprovals.find(
        (a) =>
          a.summary === spec.summary &&
          (a.status === "executed" || a.status === "approved" || a.status === "rejected" || a.status === "failed"),
      );
      if (match) {
        setApprovalId(match.id);
        setStatus(match.status as "executed" | "rejected" | "failed");
        if (match.executionResult && typeof match.executionResult === "object") {
          const res = match.executionResult as {
            verification?: { toolLabel?: string; narrative?: string; durationMs?: number; command?: string; output?: string };
          };
          if (res.verification) {
            setServerVerification(res.verification);
          }
        }
      }
    }
  }, [existingApprovals, spec.summary, status]);

  async function handleApproveAndExecute() {
    if (!opts.activeConnectionId) {
      toast.error("Router belum terhubung. Pilih router di kolom chat terlebih dahulu.");
      return;
    }

    setStatus("in_progress");
    setExecutionError(null);

    try {
      // Step 1: Create request if not created yet
      let currentId = approvalId;
      if (!currentId) {
        const created = await createApproval.mutateAsync({
          connectionId: opts.activeConnectionId,
          summary: spec.summary,
          operations: spec.operations,
          riskLevel: spec.riskLevel,
          impactDescription: spec.impactDescription,
          affectedObjects: spec.affectedObjects,
          conversationId: opts.conversationId || undefined,
        });
        currentId = created.approval.id;
        setApprovalId(currentId);
      }

      // Step 2: Approve
      await approveMutation.mutateAsync(currentId);

      // Step 3: Execute (backend automatically creates pre-change backup first!)
      const executed = await executeMutation.mutateAsync(currentId);

      if (executed.approval.status === "executed") {
        setStatus("executed");
        if (executed.approval.executionResult && typeof executed.approval.executionResult === "object") {
          const res = executed.approval.executionResult as {
            verification?: { toolLabel?: string; narrative?: string; durationMs?: number; command?: string; output?: string };
          };
          if (res.verification) {
            setServerVerification(res.verification);
          }
        }
        toast.success(`Perubahan "${spec.summary}" berhasil diterapkan ke router.`);
      } else {
        setStatus("failed");
        setExecutionError(executed.approval.executionError || "Sebagian perintah gagal dijalankan.");
        toast.error("Eksekusi perubahan menemui kegagalan.");
      }
    } catch (err) {
      setStatus("failed");
      const msg = err instanceof Error ? err.message : "Gagal menjalankan perubahan";
      setExecutionError(msg);
      toast.error(`Gagal mengeksekusi: ${msg}`);
    }
  }

  function handleReject() {
    setStatus("rejected");
    toast.info("Perubahan konfigurasi ditolak.");
    opts.onRejected?.(spec.summary);
  }

  return {
    status,
    approvalId,
    executionError,
    isExpanded,
    setIsExpanded,
    isToolExpanded,
    setIsToolExpanded,
    showLog,
    setShowLog,
    showDiff,
    setShowDiff,
    serverVerification,
    logs,
    handleApproveAndExecute,
    handleReject,
  };
}

export type ApprovalFlow = ReturnType<typeof useApprovalFlow>;
