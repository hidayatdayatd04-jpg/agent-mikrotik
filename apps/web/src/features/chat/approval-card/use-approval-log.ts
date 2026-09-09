import { useState } from "react";
import { toast } from "sonner";
import type { ApprovalSpec } from "../approval-card";
import type { OperationLogDTO } from "@shared/index";
import { generateVerificationDetails } from "../approval-verification";

export function useApprovalLogPanel(
  spec: ApprovalSpec,
  logs: OperationLogDTO[] | undefined,
  serverVerification: {
    toolLabel?: string;
    narrative?: string;
    durationMs?: number;
    command?: string;
    output?: string;
  } | null,
) {
  const [copiedLog, setCopiedLog] = useState(false);

  async function handleCopyLog() {
    const logText =
      logs && logs.length > 0
        ? logs.map((l, idx) => `[${idx + 1}] ${l.command} => ${l.status} (${l.durationMs ?? 0}ms)${l.output ? `\n${l.output}` : ""}`).join("\n")
        : spec.operations.map((o, idx) => `[${idx + 1}] ${o.command}`).join("\n");

    try {
      await navigator.clipboard.writeText(logText);
      setCopiedLog(true);
      setTimeout(() => setCopiedLog(false), 2000);
      toast.success("Log eksekusi disalin ke clipboard.");
    } catch {
      /* clipboard unavail */
    }
  }

  const verification = generateVerificationDetails({
    summary: spec.summary,
    operations: spec.operations,
    affectedObjects: spec.affectedObjects,
    logs: logs ?? [],
    narrative: serverVerification?.narrative,
    toolLabel: serverVerification?.toolLabel,
    durationMs: serverVerification?.durationMs,
    command: serverVerification?.command,
    output: serverVerification?.output,
  });

  return { copiedLog, handleCopyLog, verification, logs };
}

export type ApprovalLogPanel = ReturnType<typeof useApprovalLogPanel>;
