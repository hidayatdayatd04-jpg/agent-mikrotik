import { useMemo } from "react";
import { Plus, Search, X } from "@/components/icons";
import { Input } from "@/components/ui/input";
import { navigate } from "../lib/router";
import { useConversations, groupConversations } from "../features/chat/chat-hooks";
import { ConversationRow } from "./ConversationRow";
import { ProfileAvatar } from "./ProfileAvatar";

export function SidebarContent(props: {
  search: string;
  setSearch: (v: string) => void;
  activeId: string | null;
  onNavigate: () => void;
  profileName: string;
  profileUsername: string;
  onLogout: () => void;
}) {
  const conversations = useConversations({ search: props.search || undefined });
  const items = useMemo(() => conversations.data ?? [], [conversations.data]);
  const groups = useMemo(() => groupConversations(items), [items]);

  function newChat() {
    navigate({ name: "chat-new" });
    props.onNavigate();
  }

  function openChat(id: string) {
    navigate({ name: "chat", id });
    props.onNavigate();
  }

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-2.5 p-3">
        <button
          type="button"
          onClick={newChat}
          className="group relative flex w-full items-center justify-between overflow-hidden rounded-xl bg-gradient-to-r from-blue-600 via-indigo-600 to-violet-600 px-3.5 py-2.5 text-xs font-semibold text-white shadow-md shadow-indigo-500/20 transition-all duration-150 hover:shadow-indigo-500/35 hover:brightness-105 active:scale-[0.98] cursor-pointer"
        >
          <span className="flex items-center gap-2">
            <Plus className="size-4 transition-transform group-hover:rotate-90" />
            <span>Chat baru</span>
          </span>
          <kbd className="rounded-md bg-white/20 px-1.5 py-0.5 font-mono text-[10px] font-medium tracking-wide text-white/90">Ctrl+K</kbd>
        </button>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/70" />
          <Input
            id="sidebar-search"
            value={props.search}
            onChange={(e) => props.setSearch(e.target.value)}
            placeholder="Cari percakapan…"
            className="h-8.5 rounded-xl border-border/50 bg-muted/40 pl-8.5 pr-7 text-xs placeholder:text-muted-foreground/60 focus:bg-background transition-colors"
            aria-label="Cari percakapan"
          />
          {props.search && (
            <button
              type="button"
              onClick={() => props.setSearch("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-0.5 text-muted-foreground hover:text-foreground cursor-pointer"
              aria-label="Hapus pencarian"
            >
              <X className="size-3" />
            </button>
          )}
        </div>
      </div>
      <nav className="flex-1 space-y-4 overflow-y-auto px-2 pb-2" aria-label="Daftar percakapan">
        {conversations.isLoading && <p className="px-3 py-4 text-xs text-muted-foreground">Memuat…</p>}
        {conversations.isError && <p className="px-3 py-4 text-xs text-destructive">Gagal memuat daftar chat.</p>}
        {!conversations.isLoading && items.length === 0 && (
          <p className="px-3 py-6 text-center text-xs text-muted-foreground">Belum ada percakapan.</p>
        )}
        {groups.map((g) => (
          <div key={g.label}>
            <p className="px-2.5 pb-1.5 pt-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">{g.label}</p>
            <ul className="space-y-1.5">
              {g.items.map((c) => (
                <ConversationRow key={c.id} conv={c} active={props.activeId === c.id} onOpen={() => openChat(c.id)} />
              ))}
            </ul>
          </div>
        ))}
      </nav>
      <div className="border-t border-border/50 p-2">
        <ProfileAvatar name={props.profileName} username={props.profileUsername} onLogout={props.onLogout} onNavigate={props.onNavigate} />
      </div>
    </div>
  );
}
