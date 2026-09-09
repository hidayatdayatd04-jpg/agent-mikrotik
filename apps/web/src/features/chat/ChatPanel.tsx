import { Button } from "@/components/ui/button";
import { ArrowDown } from "@/components/icons";
import type { MessageDTO, ActivityEventDTO, RunEventDTO } from "./chat-hooks";
import { useChatScroll } from "./use-chat-scroll";
import { useChatRows } from "./use-chat-rows";
import { useMessageEditing } from "./editing";
import { MessageItem } from "./message-item";
import { LiveTurn } from "./live-turn";
import { EmptyChatState } from "./EmptyChatState";

export interface ToolActivity {
  id?: string;
  name: string;
  status: "running" | "done" | "failed";
}

export { Markdown } from "./Markdown";
export { fmtSize } from "./format-size";

export function ChatPanel(props: {
  messages: MessageDTO[];
  streamText: string;
  liveEvents?: RunEventDTO[];
  toolActivity: ToolActivity[];
  persistedActivities?: ActivityEventDTO[];
  txStatus?: string | null;
  queueStatus?: string | null;
  runLive: boolean;
  emptyTitle?: string;
  onResendPrompt?: (prompt: string) => void;
  onAnswerAsk?: (label: string) => void;
  onSendToTerminal?: (code: string) => void;
  activeConnectionId?: string | null;
  conversationId?: string | null;
}) {
  const scroll = useChatScroll(
    props.messages.length,
    props.streamText,
    props.toolActivity.length,
    props.runLive,
    props.persistedActivities?.length,
  );
  const edit = useMessageEditing();
  const { rows, byRun, liveSteps } = useChatRows(props.messages, props.persistedActivities ?? [], props.toolActivity);

  function submitEdit() {
    const trimmed = edit.editingContent.trim();
    if (!trimmed) return;
    edit.cancelEdit();
    if (props.onResendPrompt) {
      props.onResendPrompt(trimmed);
    }
  }

  const showEmpty = props.messages.length === 0 && !props.runLive && !props.streamText;

  return (
    <div className="relative flex h-full flex-col">
      {scroll.showJump && (
        <Button
          variant="outline"
          size="sm"
          className="absolute bottom-4 left-1/2 z-20 -translate-x-1/2 gap-1.5 rounded-full border-border/80 bg-card/90 px-4 shadow-lg backdrop-blur-md hover:bg-card"
          onClick={scroll.jumpToLatest}
          aria-label="Lompat ke pesan terbaru"
        >
          <ArrowDown className="size-3.5 text-indigo-500" />
          <span className="text-xs font-medium">Ke pesan terbaru</span>
        </Button>
      )}

      <div ref={scroll.containerRef} className="flex-1 overflow-y-auto px-4 py-6 sm:px-6">
        <div className="mx-auto flex max-w-[850px] flex-col gap-6">
          {showEmpty && <EmptyChatState />}

          {rows.map((row) => (
            <MessageItem
              key={row.kind === "message" ? row.m.id : row.ev.id}
              row={row}
              messages={props.messages}
              byRun={byRun}
              isEditing={row.kind === "message" && edit.editingMessageId === row.m.id}
              editingContent={edit.editingContent}
              onEditingChange={edit.setEditingContent}
              onStartEdit={(m) => edit.startEdit(m.id, m.content.text ?? "")}
              onCancelEdit={edit.cancelEdit}
              onSubmitEdit={submitEdit}
              onAnswerAsk={props.onAnswerAsk}
              onSendToTerminal={props.onSendToTerminal}
              onResendPrompt={props.onResendPrompt}
              activeConnectionId={props.activeConnectionId}
              conversationId={props.conversationId}
            />
          ))}

          <LiveTurn
            runLive={props.runLive}
            streamText={props.streamText}
            liveEvents={props.liveEvents}
            liveSteps={liveSteps}
            queueStatus={props.queueStatus}
            txStatus={props.txStatus}
            onSendToTerminal={props.onSendToTerminal}
          />

          <div ref={scroll.bottomRef} />
        </div>
      </div>
    </div>
  );
}
