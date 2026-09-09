import { TerminalPanel } from "./TerminalPanel";
import type { ConnectorDTO } from "@shared/index";

export function ChatScreenTerminal(props: {
  open: boolean;
  connector: ConnectorDTO | null;
  conversationId: string;
  initialDraft: string;
  onClose: () => void;
}) {
  if (!props.open) return null;
  return (
    <>
      <div className="hidden w-[380px] shrink-0 overflow-hidden md:block">
        <TerminalPanel
          connector={props.connector}
          conversationId={props.conversationId}
          initialDraft={props.initialDraft}
          onClose={props.onClose}
        />
      </div>
      <div className="fixed inset-0 z-50 bg-black/40 md:hidden" onClick={props.onClose}>
        <div className="absolute bottom-0 left-0 right-0 top-16 overflow-hidden rounded-t-2xl" onClick={(e) => e.stopPropagation()}>
          <TerminalPanel
            connector={props.connector}
            conversationId={props.conversationId}
            initialDraft={props.initialDraft}
            onClose={props.onClose}
          />
        </div>
      </div>
    </>
  );
}
