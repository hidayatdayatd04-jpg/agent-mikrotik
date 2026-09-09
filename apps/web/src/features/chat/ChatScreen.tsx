import { toast } from "sonner";
import { ChatPanel } from "./ChatPanel";
import { ChatComposer } from "./ChatComposer";
import { ChatScreenHeader } from "./ChatScreenHeader";
import { ChatScreenTerminal } from "./ChatScreenTerminal";
import {
  useMessages,
  useConversation,
  useConversationActivities,
  useCompactionStatus,
  useStartCompaction,
} from "./chat-hooks";
import { useConnectors } from "@/features/connectors/connector-hooks";
import { useChatRun } from "./use-chat-run";
import { useChatTarget } from "./use-chat-target";
import type { ConnectorDTO } from "@shared/index";

export function ChatScreen(props: { conversationId: string; activeConnector: ConnectorDTO | null; onToggleSidebar: () => void }) {
  const conversation = useConversation(props.conversationId);
  const messages = useMessages(props.conversationId);
  const activities = useConversationActivities(props.conversationId);
  const compaction = useCompactionStatus(props.conversationId);
  const startCompaction = useStartCompaction(props.conversationId);
  const connectors = useConnectors();
  const target = useChatTarget(props.conversationId);
  const run = useChatRun(props.conversationId, {
    terminalOpen: target.terminalOpen,
    onRunStarted: target.clearAttachments,
  });
  const runEvents = run.runEvents;
  target.setRunLive(runEvents.live);
  const title = conversation.data?.title ?? "Percakapan";
  const pinned = !!conversation.data?.pinnedAt;
  const archived = !!conversation.data?.archivedAt;

  const hasMessages = (messages.data?.length ?? 0) > 0 || runEvents.live || !!runEvents.streamText;
  const compactBusy = compaction.data?.jobs?.some((j) => j.status === "queued" || j.status === "running") ?? false;

  return (
    <div className="flex h-full overflow-hidden">
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {hasMessages && (
          <ChatScreenHeader
            conversationId={props.conversationId}
            title={title}
            pinned={pinned}
            archived={archived}
            compactBusy={compactBusy || startCompaction.isPending}
            onToggleSidebar={props.onToggleSidebar}
            onOpenTerminal={() => target.setTerminalOpen((v) => !v)}
          />
        )}
        <div className="flex-1 min-h-0 overflow-hidden">
          <ChatPanel
            messages={messages.data ?? []}
            streamText={runEvents.streamText}
            liveEvents={runEvents.events}
            toolActivity={runEvents.toolActivity}
            persistedActivities={activities.data ?? []}
            txStatus={runEvents.txStatus}
            queueStatus={runEvents.queueStatus}
            runLive={runEvents.live}
            runError={runEvents.runError}
            emptyTitle="Apa yang ingin Anda kerjakan?"
            onAnswerAsk={(label) => run.handleSend(label, [])}
            onResendPrompt={(prompt) => run.handleSend(prompt, [])}
            onRetryMessage={(messageId, text) => run.handleRetry(messageId, text)}
            onSendToTerminal={(code) => {
              target.setTerminalDraft(code);
              target.setTerminalOpen(true);
            }}
            activeConnectionId={props.activeConnector?.id ?? null}
            conversationId={props.conversationId}
          />
        </div>
        <div className="shrink-0">
          <ChatComposer
            running={runEvents.live}
            cancelling={run.cancelling}
            conversationId={props.conversationId}
            connector={props.activeConnector}
            connectors={connectors.data ?? []}
            selectedConnectorId={props.activeConnector?.id ?? null}
            onSelectConnector={target.handleSelectConnector}
            attachments={target.attachments}
            uploading={target.uploading}
            onPickFile={target.handlePickFile}
            onRemoveAttachment={target.handleRemoveAttachment}
            onSend={run.handleSend}
            onCancel={run.handleCancel}
            onAddRouter={() => {
              const returnTo = `/chat/${props.conversationId}`;
              window.location.href = `/settings/connectors?add=1&returnTo=${encodeURIComponent(returnTo)}`;
            }}
            onCompact={() => {
              startCompaction.mutate(undefined, {
                onSuccess: () => toast.success("Compact dimulai."),
                onError: (e) => toast.error(e.message),
              });
            }}
            draftKey={`composer-draft-${props.conversationId}`}
          />
        </div>
      </div>
      <ChatScreenTerminal
        open={target.terminalOpen}
        connector={props.activeConnector}
        conversationId={props.conversationId}
        initialDraft={target.terminalDraft}
        onClose={() => target.setTerminalOpen(false)}
      />
    </div>
  );
}

export type { ConnectorDTO };
