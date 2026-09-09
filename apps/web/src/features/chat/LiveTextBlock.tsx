import { stripAskBlocks } from "./ask-card";
import { stripApprovalBlocks } from "./approval-card";
import { Markdown } from "./Markdown";
import { useSmoothText } from "./use-smooth-text";

export function LiveTextBlock({
  text,
  isLatest,
  live,
  onSendToTerminal,
}: {
  text: string;
  isLatest: boolean;
  live: boolean;
  onSendToTerminal?: (code: string) => void;
}) {
  const { displayedText } = useSmoothText(text, live && isLatest);
  const clean = stripApprovalBlocks(stripAskBlocks(displayedText));
  return (
    <div className="relative">
      {clean ? <Markdown text={clean} onSendToTerminal={onSendToTerminal} /> : null}
    </div>
  );
}
