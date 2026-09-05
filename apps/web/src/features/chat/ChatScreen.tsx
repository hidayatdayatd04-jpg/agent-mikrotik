import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChatPanel } from "./ChatPanel";
import { ChatComposer } from "./ChatComposer";
import {
  useMessages,
  useStartRun,
  useCancelRun,
  useUploadAttachment,
  useDeleteAttachment,
  type AttachmentDTO,
} from "./chat-hooks";
import { useRunEvents } from "./use-run-events";
import type { ConnectorDTO } from "@shared/index";

/**
 * Chat screen (M9): full conversation flow — history, streaming run, tool
 * activity, cancel, attachments. `activeConversationId` is controlled by the
 * parent shell.
 */
export function ChatScreen(props: {
  conversationId: string;
  activeRouterLabel: string | null;
  writeMode: boolean;
}) {
  const qc = useQueryClient();
  const messages = useMessages(props.conversationId);
  const startRun = useStartRun(props.conversationId);
  const cancelRun = useCancelRun();
  const upload = useUploadAttachment(props.conversationId);
  const removeAttachment = useDeleteAttachment(props.conversationId);
  const [attachments, setAttachments] = useState<AttachmentDTO[]>([]);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const runEvents = useRunEvents(activeRunId, useCallback(() => {
    setActiveRunId(null);
    qc.invalidateQueries({ queryKey: ["messages", props.conversationId] });
    qc.invalidateQueries({ queryKey: ["conversations"] });
  }, [qc, props.conversationId]));
  const idemRef = useRef(0);

  // clear pending attachments when switching conversation
  useEffect(() => {
    setAttachments([]);
    setActiveRunId(null);
  }, [props.conversationId]);

  function handleSend(text: string, attachmentIds: string[]) {
    idemRef.current += 1;
    startRun.mutate(
      {
        text,
        idempotencyKey: `ui-${Date.now()}-${idemRef.current}-${Math.random().toString(36).slice(2, 10)}`,
        attachmentIds: attachmentIds.length ? attachmentIds : undefined,
      },
      {
        onSuccess: (res) => {
          setAttachments([]);
          if (res.resumed) {
            toast.info("Run yang sama sudah ada — melanjutkan run tersebut.");
          }
          setActiveRunId(res.runId);
        },
        onError: (err) => {
          toast.error(err.message);
        },
      },
    );
  }

  function handleCancel() {
    if (activeRunId) {
      cancelRun.mutate(activeRunId, {
        onError: (err) => toast.error(err.message),
      });
    }
  }

  function handlePickFile(file: File) {
    if (file.size > 10 * 1024 * 1024) {
      toast.error("File melebihi 10 MiB.");
      return;
    }
    upload.mutate(file, {
      onSuccess: (res) => {
        setAttachments((prev) => [...prev, res.attachment]);
      },
      onError: (err) => toast.error(err.message),
    });
  }

  function handleRemoveAttachment(id: string) {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
    removeAttachment.mutate(id, {
      onError: (err) => toast.error(err.message),
    });
  }

  const modeBadge = props.writeMode ? "Write" : "Read-Only";

  return (
    <div className="flex h-full flex-col">
      {props.activeRouterLabel && (
        <div className="flex items-center gap-2 border-b px-4 py-2 text-sm">
          <span className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium">
            <span className="size-1.5 rounded-full bg-emerald-500" aria-hidden />
            {props.activeRouterLabel}
          </span>
          <span
            className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${
              props.writeMode ? "border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-400" : ""
            }`}
          >
            Mode: {modeBadge}
          </span>
        </div>
      )}
      <ChatPanel
        messages={messages.data ?? []}
        streamText={runEvents.streamText}
        toolActivity={runEvents.toolActivity}
        runLive={runEvents.live}
        onCancel={handleCancel}
      />
      <ChatComposer
        running={runEvents.live}
        attachments={attachments}
        uploading={upload.isPending}
        onPickFile={handlePickFile}
        onRemoveAttachment={handleRemoveAttachment}
        onSend={handleSend}
        onCancel={handleCancel}
      />
    </div>
  );
}

export type { ConnectorDTO };
