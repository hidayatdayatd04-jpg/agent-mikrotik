import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChatHeader } from "./ChatHeader";
import {
  useUpdateConversation,
  useConversationActions,
  useStartCompaction,
} from "./chat-hooks";
import { navigate } from "@/lib/router";

export function ChatScreenHeader(props: {
  conversationId: string;
  title: string;
  pinned: boolean;
  archived: boolean;
  compactBusy: boolean;
  onToggleSidebar: () => void;
  onOpenTerminal: () => void;
}) {
  const qc = useQueryClient();
  const { title, pinned, archived } = props;
  const updateConversation = useUpdateConversation(props.conversationId);
  const startCompaction = useStartCompaction(props.conversationId);
  const actions = useConversationActions(props.conversationId);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");

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

  return (
    <>
      <ChatHeader
        title={title}
        onToggleSidebar={props.onToggleSidebar}
        onOpenTerminal={props.onOpenTerminal}
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
        compactBusy={props.compactBusy || startCompaction.isPending}
      />
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
    </>
  );
}
