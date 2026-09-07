import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChatPanel } from "./ChatPanel";
import { ChatComposer } from "./ChatComposer";
import { ChatHeader } from "./ChatHeader";
import { TerminalPanel } from "./TerminalPanel";
import {
  useMessages,
  useStartRun,
  useCancelRun,
  useUploadAttachment,
  useDeleteAttachment,
  useUpdateConversation,
  useConversation,
  useConversationActivities,
  useCompactionStatus,
  useStartCompaction,
  useConversationActions,
  type AttachmentDTO,
} from "./chat-hooks";
import { useConnectors } from "@/features/connectors/connector-hooks";
import { useRunEvents } from "./use-run-events";
import { navigate } from "@/lib/router";
import type { ConnectorDTO } from "@shared/index";
import { useAiProviders } from "./chat-hooks";
import { readProviderSelection, resolveProviderSelection } from "./provider-selection";

export function ChatScreen(props: { conversationId: string; activeConnector: ConnectorDTO | null; onToggleSidebar: () => void }) {
  const qc = useQueryClient();
  const providers = useAiProviders();
  const conversation = useConversation(props.conversationId);
  const messages = useMessages(props.conversationId);
  const activities = useConversationActivities(props.conversationId);
  const compaction = useCompactionStatus(props.conversationId);
  const startCompaction = useStartCompaction(props.conversationId);
  const actions = useConversationActions(props.conversationId);
  const startRun = useStartRun(props.conversationId);
  const cancelRun = useCancelRun();
  const upload = useUploadAttachment(props.conversationId);
  const removeAttachment = useDeleteAttachment(props.conversationId);
  const updateConversation = useUpdateConversation(props.conversationId);
  const connectors = useConnectors();
  const [attachments, setAttachments] = useState<AttachmentDTO[]>([]);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [terminalDraft, setTerminalDraft] = useState<string>("");
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const runEvents = useRunEvents(
    activeRunId,
    useCallback(() => {
      setActiveRunId(null);
      qc.invalidateQueries({ queryKey: ["messages", props.conversationId] });
      qc.invalidateQueries({ queryKey: ["conversations"] });
      qc.invalidateQueries({ queryKey: ["ai-providers"] });
      qc.invalidateQueries({ queryKey: ["activities", props.conversationId] });
    }, [qc, props.conversationId]),
  );
  const idemRef = useRef(0);
  const title = conversation.data?.title ?? "Percakapan";
  const pinned = !!conversation.data?.pinnedAt;
  const archived = !!conversation.data?.archivedAt;

  useEffect(() => {
    setAttachments([]);
    setActiveRunId(null);
    setTerminalOpen(false);
  }, [props.conversationId]);

  // Pending prompt from new-chat flow (sessionStorage) — auto-send once.
  useEffect(() => {
    let cancelled = false;
    const key = `pending-prompt-${props.conversationId}`;
    let pending: string | null = null;
    try {
      pending = sessionStorage.getItem(key);
    } catch {
      pending = null;
    }
    if (pending && !activeRunId && messages.data !== undefined && providers.data !== undefined) {
      queueMicrotask(() => {
        if (cancelled) return;
        try {
          sessionStorage.removeItem(key);
        } catch {
          /* ignore */
        }
        handleSend(pending!, []);
      });
    }
    return () => {
      cancelled = true;
    };
  }, [props.conversationId, messages.data, providers.data]);

  function handleSend(text: string, attachmentIds: string[], model?: string, providerId?: string) {
    const selected = resolveProviderSelection(providers.data ?? [], readProviderSelection());
    if (terminalOpen) {
      // Terminal state doesn't block chat, but keep draft intact notice.
    }
    idemRef.current += 1;
    startRun.mutate(
      {
        text,
        idempotencyKey: `ui-${Date.now()}-${idemRef.current}-${Math.random().toString(36).slice(2, 10)}`,
        attachmentIds: attachmentIds.length ? attachmentIds : undefined,
        model: model ?? selected?.model,
        providerId: providerId ?? selected?.providerId,
      },
      {
        onSuccess: (res) => {
          setAttachments([]);
          if (res.resumed) toast.info("Run yang sama sudah ada — melanjutkan run tersebut.");
          setActiveRunId(res.runId);
        },
        onError: (err) => toast.error(err.message),
      },
    );
  }

  function handleCancel() {
    if (activeRunId) cancelRun.mutate(activeRunId, { onError: (err) => toast.error(err.message) });
  }

  function handleSelectConnector(id: string) {
    if (runEvents.live) {
      toast.error("Run sedang aktif — tunggu selesai sebelum mengganti connector.");
      return;
    }
    if (terminalOpen) {
      // Check terminal active commands via query? Optimistic guard.
      toast.error("Terminal aktif — hentikan command dulu sebelum mengganti target.");
      return;
    }
    updateConversation.mutate(
      { connectionId: id },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: ["conversation", props.conversationId] });
          qc.invalidateQueries({ queryKey: ["conversations"] });
          toast.success("Connector diperbarui.");
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
      onSuccess: (res) => setAttachments((prev) => [...prev, res.attachment]),
      onError: (err) => toast.error(err.message),
    });
  }

  function handleRemoveAttachment(id: string) {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
    removeAttachment.mutate(id, { onError: (err) => toast.error(err.message) });
  }

  async function handleRenameSave() {
    const t = renameValue.trim();
    if (!t) {
      toast.error("Nama tidak boleh kosong.");
      return;
    }
    try {
      await updateConversation.mutateAsync({ title: t });
      toast.success("Nama diubah.");
      setRenaming(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal rename.");
    }
  }

  async function handleDelete() {
    if (!confirm("Hapus percakapan ini secara permanen?")) return;
    try {
      const { apiFetch } = await import("@/lib/api");
      await apiFetch(`/api/conversations/${props.conversationId}`, { method: "DELETE" });
      toast.success("Percakapan dihapus.");
      qc.invalidateQueries({ queryKey: ["conversations"] });
      navigate({ name: "chat-new" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal menghapus. Hentikan run/terminal dulu.");
    }
  }

  const hasMessages = (messages.data?.length ?? 0) > 0 || runEvents.live || !!runEvents.streamText;
  const compactBusy = compaction.data?.jobs.some((j) => j.status === "queued" || j.status === "running") ?? false;

  return (
    <div className="flex h-full overflow-hidden">
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {hasMessages && (
          <ChatHeader
            title={title}
            onToggleSidebar={props.onToggleSidebar}
            onOpenTerminal={() => setTerminalOpen((v) => !v)}
            onExport={() => void actions.exportMd()}
            onRename={() => {
              setRenameValue(title);
              setRenaming(true);
            }}
            onPin={() => {
              updateConversation.mutate(
                { pinned: !pinned },
                { onSuccess: () => toast.success(!pinned ? "Disematkan." : "Pin dilepas."), onError: (e) => toast.error(e.message) },
              );
            }}
            pinned={pinned}
            onArchive={() => {
              updateConversation.mutate(
                { archived: !archived },
                {
                  onSuccess: () => {
                    toast.success(!archived ? "Diarsipkan." : "Dipulihkan.");
                    if (!archived) navigate({ name: "chat-new" });
                  },
                  onError: (e) => toast.error(e.message),
                },
              );
            }}
            archived={archived}
            onCompact={() => {
              startCompaction.mutate(undefined, {
                onSuccess: (r) => toast.success(`Compact dimulai (${r.status}).`),
                onError: (e) => toast.error(e.message),
              });
            }}
            onDelete={() => void handleDelete()}
            compactBusy={compactBusy || startCompaction.isPending}
          />
        )}
        {renaming && (
          <div className="flex items-center gap-2 border-b border-border/60 px-4 py-2">
            <input
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              className="h-8 flex-1 rounded-lg border border-border/70 bg-background px-2 text-sm"
              autoFocus
              aria-label="Nama baru percakapan"
            />
            <button type="button" className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs text-white" onClick={() => void handleRenameSave()}>
              Simpan
            </button>
            <button type="button" className="rounded-md px-2 py-1.5 text-xs text-muted-foreground" onClick={() => setRenaming(false)}>
              Batal
            </button>
          </div>
        )}
        {!hasMessages && (
          <div className="flex items-center gap-2 px-3 py-2">
            <button type="button" onClick={props.onToggleSidebar} className="rounded-md p-2 hover:bg-muted" aria-label="Buka/tutup sidebar">
              ☰
            </button>
          </div>
        )}
        <div className="flex-1 min-h-0 overflow-hidden">
          <ChatPanel
            messages={messages.data ?? []}
          streamText={runEvents.streamText}
          liveEvents={runEvents.events}
            toolActivity={runEvents.toolActivity}
            persistedActivities={activities.data ?? []}
            txStatus={runEvents.txStatus}
            runLive={runEvents.live}
            emptyTitle="Apa yang ingin Anda kerjakan?"
            onAnswerAsk={(label) => handleSend(label, [])}
            onResendPrompt={(prompt) => handleSend(prompt, [])}
            onSendToTerminal={(code) => {
              setTerminalDraft(code);
              setTerminalOpen(true);
            }}
          />
        </div>
        <div className="shrink-0">
          <ChatComposer
            running={runEvents.live}
            cancelling={cancelRun.isPending}
            conversationId={props.conversationId}
            connector={props.activeConnector}
            connectors={connectors.data ?? []}
            selectedConnectorId={props.activeConnector?.id ?? null}
            onSelectConnector={handleSelectConnector}
            attachments={attachments}
            uploading={upload.isPending}
            onPickFile={handlePickFile}
            onRemoveAttachment={handleRemoveAttachment}
            onSend={handleSend}
            onCancel={handleCancel}
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
      {terminalOpen && (
        <div className="hidden w-[380px] shrink-0 overflow-hidden md:block">
          <TerminalPanel
            connector={props.activeConnector}
            conversationId={props.conversationId}
            initialDraft={terminalDraft}
            onClose={() => setTerminalOpen(false)}
          />
        </div>
      )}
      {terminalOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 md:hidden" onClick={() => setTerminalOpen(false)}>
          <div className="absolute bottom-0 left-0 right-0 top-16 overflow-hidden rounded-t-2xl" onClick={(e) => e.stopPropagation()}>
            <TerminalPanel
              connector={props.activeConnector}
              conversationId={props.conversationId}
              initialDraft={terminalDraft}
              onClose={() => setTerminalOpen(false)}
            />
          </div>
        </div>
      )}
    </div>
  );
}

export type { ConnectorDTO };
