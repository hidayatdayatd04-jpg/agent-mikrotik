import { extractAskBlocks, stripAskBlocks } from "./ask-card";
import { AskCard } from "./AskCard";
import { extractApprovalBlocks, stripApprovalBlocks } from "./approval-card";
import { ApprovalCard } from "./ApprovalCard";
import { Markdown } from "./Markdown";

export function AssistantBody({
  text,
  onAnswerAsk,
  onSendToTerminal,
  activeConnectionId,
  conversationId,
}: {
  text: string;
  onAnswerAsk?: (label: string) => void;
  onSendToTerminal?: (code: string) => void;
  activeConnectionId?: string | null;
  conversationId?: string | null;
}) {
  const specs = onAnswerAsk ? extractAskBlocks(text) : null;
  const approvalSpecs = extractApprovalBlocks(text);
  let body = text;
  if (specs) body = stripAskBlocks(body);
  if (approvalSpecs) body = stripApprovalBlocks(body);
  return (
    <>
      {body && <Markdown text={body} onSendToTerminal={onSendToTerminal} />}
      {approvalSpecs &&
        approvalSpecs.map((spec, i) => (
          <ApprovalCard key={i} spec={spec} activeConnectionId={activeConnectionId} conversationId={conversationId} />
        ))}
      {specs && onAnswerAsk ? specs.map((spec, i) => <AskCard key={i} spec={spec} onAnswer={onAnswerAsk} />) : null}
    </>
  );
}
