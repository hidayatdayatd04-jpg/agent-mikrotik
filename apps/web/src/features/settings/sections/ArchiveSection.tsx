import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useArchivedConversations, useConversationActions } from "@/features/chat/chat-hooks";
import { navigate } from "@/lib/router";

export function ArchiveSection() {
  const archived = useArchivedConversations();
  const items = archived.data ?? [];
  return (
    <div className="space-y-4">
      <h2 className="text-base font-semibold">Arsip percakapan</h2>
      {archived.isLoading && <p className="text-xs text-muted-foreground">Memuat arsip…</p>}
      {archived.isError && <p className="text-xs text-destructive">Gagal memuat arsip.</p>}
      {!archived.isLoading && items.length === 0 && <p className="text-xs text-muted-foreground">Arsip kosong.</p>}
      <ul className="space-y-2">
        {items.map((c) => (
          <ArchiveRow key={c.id} id={c.id} title={c.title} />
        ))}
      </ul>
    </div>
  );
}

function ArchiveRow({ id, title }: { id: string; title: string }) {
  const actions = useConversationActions(id);
  return (
    <li className="flex items-center justify-between gap-2 rounded-xl border border-border/70 bg-card/60 px-3 py-2 text-xs">
      <span className="truncate">{title}</span>
      <span className="flex shrink-0 gap-1">
        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => actions.setArchived(false).then(() => toast.success("Dipulihkan."))}>
          Pulihkan
        </Button>
        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => navigate({ name: "chat", id })}>
          Buka
        </Button>
      </span>
    </li>
  );
}
