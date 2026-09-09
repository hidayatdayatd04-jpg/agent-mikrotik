import { User } from "@/components/icons";
import type { MessageDTO, ActivityEventDTO } from "./chat-hooks";
import { CompactionNotice } from "./ToolActivity";
import { UserMessage } from "./UserMessage";
import { AssistantMessage } from "./AssistantMessage";
import type { ChatRow } from "./use-chat-rows";

export function MessageItem(props: {
  row: ChatRow;
  messages: MessageDTO[];
  byRun: Map<string, ActivityEventDTO[]>;
  isEditing: boolean;
  editingContent: string;
  onEditingChange: (v: string) => void;
  onStartEdit: (m: MessageDTO) => void;
  onCancelEdit: () => void;
  onSubmitEdit: () => void;
  onAnswerAsk?: (label: string) => void;
  onSendToTerminal?: (code: string) => void;
  onResendPrompt?: (prompt: string) => void;
  onRetryMessage?: (messageId: string, text: string) => void;
  actionsDisabled?: boolean;
  activeConnectionId?: string | null;
  conversationId?: string | null;
}) {
  const { row } = props;
  if (row.kind === "compaction") {
    return <CompactionNotice key={row.ev.id} event={row.ev} />;
  }
  const m = row.m;
  const isUser = m.role === "user";
  const runActs = !isUser && m.content.runId ? props.byRun.get(m.content.runId) : undefined;

  return (
    <div key={m.id} className={`group flex gap-3 animate-in fade-in duration-200 ${isUser ? "justify-end" : "justify-start"}`}>
      {!isUser && (
        <div className="flex size-9 shrink-0 select-none items-center justify-center rounded-xl overflow-hidden ring-1 ring-cyan-500/30 bg-card shadow-xs">
          <img src="/logo.png" alt="MikroTik AI" className="size-full object-contain p-0.5" />
        </div>
      )}

      <div className="max-w-[85%] sm:max-w-[80%] space-y-1">
        {isUser ? (
          <UserMessage
            m={m}
            isEditing={props.isEditing}
            editingContent={props.editingContent}
            onEditingChange={props.onEditingChange}
            onStartEdit={() => props.onStartEdit(m)}
            onCancelEdit={props.onCancelEdit}
            onSubmitEdit={props.onSubmitEdit}
            editDisabled={props.actionsDisabled}
          />
        ) : (
          <AssistantMessage
            m={m}
            messages={props.messages}
            runActs={runActs}
            onAnswerAsk={props.onAnswerAsk}
            onSendToTerminal={props.onSendToTerminal}
            onResendPrompt={props.onResendPrompt}
            onRetryMessage={props.onRetryMessage}
            actionsDisabled={props.actionsDisabled}
            activeConnectionId={props.activeConnectionId}
            conversationId={props.conversationId}
          />
        )}
      </div>

      {isUser && (
        <div className="flex size-8 shrink-0 select-none items-center justify-center rounded-xl bg-muted text-muted-foreground shadow-xs border border-border/60">
          <User className="size-4" />
        </div>
      )}
    </div>
  );
}
