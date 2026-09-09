import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MessageSquare, Pin, Check, X } from "@/components/icons";
import { navigate } from "../lib/router";
import { useUpdateConversation, useDeleteConversation, type ConversationDTO } from "../features/chat/chat-hooks";
import { ConversationRowMenu } from "./ConversationRowMenu";

export function ConversationRow({ conv, active, onOpen }: { conv: ConversationDTO; active: boolean; onOpen: () => void }) {
  const update = useUpdateConversation(conv.id);
  const del = useDeleteConversation();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(conv.title);

  async function doPin(pinned: boolean) {
    try {
      await update.mutateAsync({ pinned });
      toast.success(pinned ? "Chat disematkan." : "Pin dilepas.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal.");
    }
  }
  async function doArchive(archived: boolean) {
    try {
      await update.mutateAsync({ archived });
      toast.success(archived ? "Chat diarsipkan." : "Chat dipulihkan.");
      if (archived && active) navigate({ name: "chat-new" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal. Hentikan run/terminal dulu.");
    }
  }
  async function doDelete() {
    if (!confirm("Hapus percakapan ini secara permanen?")) return;
    try {
      await del.mutateAsync(conv.id);
      toast.success("Percakapan dihapus.");
      if (active) navigate({ name: "chat-new" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal menghapus.");
    }
  }
  async function doExport() {
    try {
      const res = await fetch(`/api/conversations/${conv.id}/export?format=md`, { credentials: "same-origin" });
      if (!res.ok) throw new Error("Export gagal.");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${conv.title.slice(0, 40)}.md`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Export gagal.");
    }
  }

  if (editing) {
    return (
      <li className="flex items-center gap-1 rounded-xl border border-indigo-500 bg-background p-1">
        <Input value={title} onChange={(e) => setTitle(e.target.value)} className="h-7 text-xs" autoFocus aria-label="Nama percakapan" />
        <Button
          size="icon"
          variant="ghost"
          className="size-7"
          aria-label="Simpan nama"
          onClick={() => {
            const t = title.trim();
            if (!t) return;
            update.mutate(
              { title: t },
              {
                onSuccess: () => {
                  setEditing(false);
                  toast.success("Nama diubah.");
                },
                onError: (e) => toast.error(e.message),
              },
            );
          }}
        >
          <Check className="size-3.5" />
        </Button>
        <Button size="icon" variant="ghost" className="size-7" aria-label="Batal" onClick={() => setEditing(false)}>
          <X className="size-3.5" />
        </Button>
      </li>
    );
  }

  return (
    <li className="group relative">
      <div
        role="button"
        tabIndex={0}
        onClick={onOpen}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onOpen();
          }
        }}
        className={`flex w-full cursor-pointer items-center justify-between gap-2 rounded-xl px-2.5 py-2.5 text-left transition-all ${
          active
            ? "bg-accent/80 text-foreground font-medium shadow-xs ring-1 ring-border/70"
            : "text-muted-foreground hover:bg-accent/40 hover:text-foreground"
        }`}
        title={`${conv.title} · dibuat ${new Date(conv.createdAt).toLocaleString("id-ID")}`}
      >
        <span className="flex min-w-0 items-center gap-2 flex-1">
          {conv.pinnedAt ? (
            <Pin className="size-3.5 shrink-0 text-amber-500 fill-amber-500/20" />
          ) : (
            <MessageSquare className={`size-3.5 shrink-0 ${active ? "text-indigo-600 dark:text-indigo-400" : "text-muted-foreground/60"}`} />
          )}
          <span className="min-w-0 flex-1">
            <span className={`block truncate text-xs ${active ? "font-semibold text-foreground" : "font-medium"}`}>{conv.title}</span>
            <span className="block truncate text-[10px] text-muted-foreground/75 mt-1">
              {new Date(conv.createdAt).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" })}
            </span>
          </span>
        </span>
        <ConversationRowMenu
          title={conv.title}
          pinned={!!conv.pinnedAt}
          onRename={() => {
            setTitle(conv.title);
            setEditing(true);
          }}
          onPin={() => void doPin(!conv.pinnedAt)}
          onArchive={() => void doArchive(true)}
          onExport={() => void doExport()}
          onDelete={() => void doDelete()}
          onTriggerClick={(e) => e.stopPropagation()}
        />
      </div>
    </li>
  );
}
