import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plug } from "lucide-react";
import { ChatPanel } from "./ChatPanel";
import { ChatComposer } from "./ChatComposer";
import {
  useMessages,
  useStartRun,
  useCancelRun,
  useUploadAttachment,
  useDeleteAttachment,
  useUpdateConversation,
  type AttachmentDTO,
} from "./chat-hooks";
import { useConnectors, useSetConnectorMode } from "@/features/connectors/connector-hooks";
import { useRunEvents } from "./use-run-events";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ConnectorDTO } from "@shared/index";

/**
 * Chat screen: full conversation flow — history, streaming run, tool
 * activity, cancel, attachments, real router/mode header with Write
 * toggle (M10 wiring). `activeConversationId` is controlled by the
 * parent shell.
 */
export function ChatScreen(props: {
  conversationId: string;
  activeRouterLabel: string | null;
  writeMode: boolean;
  activeConnector: ConnectorDTO | null;
}) {
  const qc = useQueryClient();
  const messages = useMessages(props.conversationId);
  const startRun = useStartRun(props.conversationId);
  const cancelRun = useCancelRun();
  const upload = useUploadAttachment(props.conversationId);
  const removeAttachment = useDeleteAttachment(props.conversationId);
  const updateConversation = useUpdateConversation(props.conversationId);
  const connectors = useConnectors();
  const setMode = useSetConnectorMode(props.activeConnector?.id ?? "");
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

  async function handleToggleWrite(next: boolean) {
    if (!props.activeConnector) return;
    try {
      await setMode.mutateAsync({
        mode: next ? "write" : "read-only",
        expectedVersion: props.activeConnector.modeVersion,
      });
      toast.success(next ? "Mode Write aktif — mutasi akan berjalan dalam transaksi Safe Mode." : "Mode kembali Read-Only.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal mengubah mode.");
      // authoritative state is the connector list — refetch
      qc.invalidateQueries({ queryKey: ["connectors"] });
    }
  }

  function handlePickConnection(connectorId: string | null) {
    updateConversation.mutate(
      { connectionId: connectorId },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: ["conversation", props.conversationId] });
          qc.invalidateQueries({ queryKey: ["conversations"] });
          toast.success(connectorId ? "Router percakapan diperbarui." : "Router dilepas dari percakapan.");
        },
        onError: (err) => toast.error(err.message),
      },
    );
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

  const connected = props.activeConnector?.status === "connected";
  const modeBadge = props.writeMode ? "Write" : "Read-Only";

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b px-4 py-2 text-sm">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="gap-2" aria-label="Pilih router percakapan">
              <Plug className="size-4" aria-hidden />
              {props.activeRouterLabel ?? "Tanpa router"}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuLabel>Router percakapan</DropdownMenuLabel>
            <DropdownMenuItem onClick={() => handlePickConnection(null)}>
              Tanpa router (dokumentasi saja)
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {(connectors.data ?? []).map((c) => (
              <DropdownMenuItem
                key={c.id}
                onClick={() => handlePickConnection(c.id)}
              >
                {c.label} ({c.host}) — {c.status === "connected" ? "terhubung" : c.status}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <span
          className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${
            props.writeMode ? "border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-400" : ""
          }`}
        >
          Mode: {modeBadge}
        </span>
        {props.activeConnector && (
          <label
            className="flex items-center gap-2 text-xs"
            title={connected ? "Mode Write" : "Hubungkan router dulu untuk mengubah mode"}
          >
            <span className={props.writeMode ? "font-medium" : "text-muted-foreground"}>Write</span>
            <Switch
              checked={props.writeMode}
              disabled={!connected || setMode.isPending || runEvents.live}
              onCheckedChange={handleToggleWrite}
              aria-label="Mode write"
            />
          </label>
        )}
        {runEvents.txStatus && (
          <span className="ml-auto inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium">
            {runEvents.txStatus}
          </span>
        )}
      </div>
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
