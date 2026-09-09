import { Plus, Search, PanelLeftClose } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { navigate } from "../lib/router";
import { NotificationBell } from "../features/notifications/NotificationBell";
import { SidebarContent } from "./SidebarContent";
import { ProfileAvatar } from "./ProfileAvatar";

export function DesktopSidebar(props: {
  collapsed: boolean;
  onCollapse: () => void;
  onExpand: () => void;
  onExpandAndFocusSearch: () => void;
  search: string;
  setSearch: (v: string) => void;
  conversationId: string | null;
  profileName: string;
  profileUsername: string;
  onLogout: () => void;
}) {
  if (props.collapsed) {
    return (
      <aside className="hidden w-16 shrink-0 flex-col items-center border-r border-border/60 bg-sidebar/95 py-3.5 md:flex" aria-label="Sidebar ringkas">
        {/* Website Logo as the sidebar expand button */}
        <button
          type="button"
          onClick={props.onExpand}
          className="group relative flex size-9 items-center justify-center rounded-xl bg-card p-1 shadow-xs ring-1 ring-border/80 transition-all hover:scale-105 hover:ring-cyan-500/60 active:scale-95 cursor-pointer"
          aria-label="Buka sidebar"
          title="Buka sidebar (MikroTik AI)"
        >
          <img src="/logo.png" alt="MikroTik AI" className="size-full object-contain transition-transform group-hover:scale-105" />
          <span className="sr-only">Buka sidebar</span>
        </button>

        <div className="my-2.5 h-px w-6 bg-border/60" />

        <div className="flex flex-col items-center gap-1.5">
          <Button
            variant="ghost"
            size="icon"
            className="size-9 rounded-xl text-muted-foreground hover:bg-accent hover:text-foreground transition-all cursor-pointer"
            onClick={() => navigate({ name: "chat-new" })}
            aria-label="Chat baru (Ctrl+K)"
            title="Chat baru (Ctrl+K)"
          >
            <Plus className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-9 rounded-xl text-muted-foreground hover:bg-accent hover:text-foreground transition-all cursor-pointer"
            aria-label="Cari percakapan"
            title="Cari percakapan"
            onClick={props.onExpandAndFocusSearch}
          >
            <Search className="size-4" />
          </Button>
          <NotificationBell collapsed onNavigate={() => {}} />
        </div>

        <div className="flex-1" />
        <ProfileAvatar name={props.profileName} username={props.profileUsername} onLogout={props.onLogout} collapsed />
      </aside>
    );
  }

  return (
    <aside className="hidden w-[272px] shrink-0 flex-col border-r border-border/60 bg-sidebar/95 md:flex" aria-label="Sidebar chat">
      <div className="flex items-center justify-between border-b border-border/50 px-3.5 py-3">
        <div className="flex items-center gap-2.5">
          <div className="flex size-8 items-center justify-center overflow-hidden rounded-xl bg-card p-1 shadow-xs ring-1 ring-cyan-500/30">
            <img src="/logo.png" alt="MikroTik AI" className="size-full object-contain" />
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-bold tracking-tight text-foreground">MikroTik AI</span>
            <span className="rounded-md bg-indigo-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-600 dark:text-indigo-400">
              Agent
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <NotificationBell onNavigate={() => {}} />
          <Button
            variant="ghost"
            size="icon"
            className="size-7 rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground transition-all cursor-pointer"
            onClick={props.onCollapse}
            aria-label="Tutup sidebar"
            title="Tutup sidebar"
          >
            <PanelLeftClose className="size-4" />
          </Button>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        <SidebarContent
          search={props.search}
          setSearch={props.setSearch}
          activeId={props.conversationId}
          onNavigate={() => {}}
          profileName={props.profileName}
          profileUsername={props.profileUsername}
          onLogout={props.onLogout}
        />
      </div>
    </aside>
  );
}
