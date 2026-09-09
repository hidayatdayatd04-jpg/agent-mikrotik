import type { ApprovalSpec } from "./approval-card";
import { useApprovalFlow } from "./approval-card/use-approval-flow";
import { useApprovalLogPanel } from "./approval-card/use-approval-log";
import { ApprovalPendingCard } from "./approval-card/ApprovalPendingCard";
import { ApprovalExecutedCard } from "./approval-card/ApprovalExecutedCard";
import { ApprovalRejectedCard } from "./approval-card/ApprovalRejectedCard";

interface Props {
  spec: ApprovalSpec;
  activeConnectionId?: string | null;
  conversationId?: string | null;
  onRejected?: (summary: string) => void;
}

export function ApprovalCard({ spec, activeConnectionId, conversationId, onRejected }: Props) {
  const flow = useApprovalFlow(spec, { activeConnectionId, conversationId, onRejected });
  const log = useApprovalLogPanel(spec, flow.logs, flow.serverVerification);

  // Render when already executed (Executed / Verified State in the SAME Chat Output)
  if (flow.status === "executed") {
    return <ApprovalExecutedCard spec={spec} flow={flow} log={log} />;
  }

  // Render when rejected
  if (flow.status === "rejected") {
    return (
      <ApprovalRejectedCard spec={spec} expanded={flow.isExpanded} onToggle={() => flow.setIsExpanded(!flow.isExpanded)} />
    );
  }

  // Render when idle or in_progress or failed
  return <ApprovalPendingCard spec={spec} flow={flow} />;
}
