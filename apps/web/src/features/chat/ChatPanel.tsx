import { Button } from "@/components/ui/button";
import { ArrowDown } from "@/components/icons";
import type { MessageDTO, ActivityEventDTO, RunEventDTO } from "./chat-hooks";
import type { LiveRunError } from "./run-event-types";
import { useChatScroll } from "./use-chat-scroll";
import { useChatRows } from "./use-chat-rows";
import { useMessageEditing } from "./editing";
import { MessageItem } from "./message-item";
import { LiveTurn } from "./live-turn";
import { RunErrorCard } from "./RunErrorCard";
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
  runError?: LiveRunError | null;
  emptyTitle?: string;
  onResendPrompt?: (prompt: string) => void;
  /** Retry in-place untuk pesan user yang diedit (tanpa pesan duplikat). */
  onRetryMessage?: (messageId: string, text: string) => void;
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
    const editingId = edit.editingMessageId;
    if (!trimmed || !editingId) return;
    const idx = props.messages.findIndex((mm) => mm.id === editingId);
    const edited = idx >= 0 ? props.messages[idx] : undefined;
    // Retry in-place bila yang diedit adalah giliran user TERAKHIR (tidak ada
    // pesan user lain di bawahnya) — teks diperbarui di tempat, jawaban
    // kedaluwarsa di bawahnya diganti, tanpa pesan duplikat. Bila pengedit
    // berada di atas (percakapan sudah berlanjut), kirim sebagai pesan baru.
    const hasUserBelow =
      idx >= 0 && props.messages.slice(idx + 1).some((mm) => mm.role === "user");
    edit.cancelEdit();
    if (edited?.role === "user" && !hasUserBelow && props.onRetryMessage) {
      props.onRetryMessage(editingId, trimmed);
    } else if (props.onResendPrompt) {
      props.onResendPrompt(trimmed);
    }
  }

  const showEmpty = props.messages.length === 0 && !props.runLive && !props.streamText;

  // Kartu error live (dari event run.failed) — disembunyikan begitu pesan
  // gagalnya sudah tersimpan, agar tidak tampil ganda.
  const liveError =
    props.runError &&
    !props.messages.some((mm) => mm.role === "assistant" && mm.content.runId === props.runError?.runId)
      ? props.runError
      : null;

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
              onRetryMessage={props.onRetryMessage}
              actionsDisabled={props.runLive}
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

          {liveError && (
            <div className="animate-in fade-in duration-200">
              <RunErrorCard
                error={liveError}
                onRetry={props.onResendPrompt ? () => props.onResendPrompt?.("continue") : undefined}
              />
            </div>
          )}

          <div ref={scroll.bottomRef} />
        </div>
      </div>
    </div>
  );
}
