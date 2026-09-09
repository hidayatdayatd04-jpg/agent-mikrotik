import { Check, MoreHorizontal, User, Settings, LogOut, Network, BarChart3, Bell, Archive } from "@/components/icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useRoute, navigate } from "../lib/router";
import { useConversation } from "../features/chat/chat-hooks";
import { ThemeToggleMenuItem } from "./ThemeToggle";

export function ProfileAvatar({
  name,
  username,
  onLogout,
  collapsed,
  onNavigate,
}: {
  name: string;
  username: string;
  onLogout: () => void;
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  const route = useRoute();
  const conversation = useConversation(route.name === "chat" ? route.id : null);
  const initials = (name || username || "MA").slice(0, 2).toUpperCase();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={
            collapsed
              ? "group flex size-9 items-center justify-center rounded-xl border-0 p-0.5 transition-all outline-none hover:bg-accent/70 focus-visible:outline-none active:scale-95 cursor-pointer data-[state=open]:bg-accent/70"
              : "group flex w-full items-center gap-2.5 rounded-xl border-0 p-2 text-left transition-all outline-none hover:bg-accent/50 focus-visible:outline-none active:scale-[0.99] cursor-pointer data-[state=open]:bg-accent/50"
          }
          aria-label="Menu profil"
          data-network-map-active={route.name === "network-map" || undefined}
          title={`${name} (@${username})`}
        >
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 via-indigo-600 to-violet-700 text-[11px] font-bold text-white shadow-xs ring-1 ring-white/20 transition-transform group-hover:scale-105">
            {initials}
          </span>
          {!collapsed && (
            <>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-semibold text-foreground">{name}</span>
                <span className="block truncate text-[11px] text-muted-foreground">@{username}</span>
              </span>
              <MoreHorizontal className="size-4 shrink-0 text-muted-foreground/60 transition-colors group-hover:text-foreground" />
            </>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align={collapsed ? "end" : "start"}
        side="top"
        sideOffset={8}
        className="w-56 rounded-2xl border border-border/60 bg-popover/95 p-2 shadow-xl backdrop-blur-md space-y-1"
      >
        <div className="flex items-center gap-2.5 px-2.5 py-2">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 via-indigo-600 to-violet-700 text-[11px] font-bold text-white shadow-xs">
            {initials}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold leading-tight text-foreground">{name}</p>
            <p className="truncate text-[11px] text-muted-foreground">@{username}</p>
          </div>
        </div>
        <DropdownMenuSeparator className="my-1.5" />
        <DropdownMenuItem
          aria-current={route.name === "network-map" ? "page" : undefined}
          onClick={() => {
            navigate({ name: "network-map", id: route.name === "network-map" ? route.id : (conversation.data?.activeConnectionId ?? undefined) });
            onNavigate?.();
          }}
          className={`gap-2.5 px-2.5 py-2.5 text-xs font-medium rounded-xl cursor-pointer ${route.name === "network-map" ? "bg-accent text-foreground" : ""}`}
        >
          <Network className="size-4 text-cyan-600 dark:text-cyan-400" />
          <span>Network Map</span>
          {route.name === "network-map" && <Check className="ml-auto size-3.5" />}
        </DropdownMenuItem>
        <DropdownMenuItem
          aria-current={route.name === "monitoring" ? "page" : undefined}
          onClick={() => {
            navigate({ name: "monitoring", id: route.name === "monitoring" ? route.id : (conversation.data?.activeConnectionId ?? undefined) });
            onNavigate?.();
          }}
          className={`gap-2.5 px-2.5 py-2.5 text-xs font-medium rounded-xl cursor-pointer ${route.name === "monitoring" ? "bg-accent text-foreground" : ""}`}
        >
          <BarChart3 className="size-4 text-emerald-600 dark:text-emerald-400" />
          <span>Monitoring Dashboard</span>
          {route.name === "monitoring" && <Check className="ml-auto size-3.5" />}
        </DropdownMenuItem>
        <DropdownMenuItem
          aria-current={route.name === "notifications" ? "page" : undefined}
          onClick={() => {
            navigate({ name: "notifications" });
            onNavigate?.();
          }}
          className={`gap-2.5 px-2.5 py-2.5 text-xs font-medium rounded-xl cursor-pointer ${route.name === "notifications" ? "bg-accent text-foreground" : ""}`}
        >
          <Bell className="size-4 text-rose-500" />
          <span>Notifikasi</span>
          {route.name === "notifications" && <Check className="ml-auto size-3.5" />}
        </DropdownMenuItem>
        <DropdownMenuItem
          aria-current={route.name === "backups" ? "page" : undefined}
          onClick={() => {
            navigate({ name: "backups", id: route.name === "backups" ? route.id : (conversation.data?.activeConnectionId ?? undefined) });
            onNavigate?.();
          }}
          className={`gap-2.5 px-2.5 py-2.5 text-xs font-medium rounded-xl cursor-pointer ${route.name === "backups" ? "bg-accent text-foreground" : ""}`}
        >
          <Archive className="size-4 text-indigo-500" />
          <span>Backup & Diff</span>
          {route.name === "backups" && <Check className="ml-auto size-3.5" />}
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => navigate({ name: "settings", section: "profile" })}
          className="gap-2.5 px-2.5 py-2.5 text-xs font-medium rounded-xl cursor-pointer"
        >
          <User className="size-4 text-muted-foreground" />
          <span>Profil</span>
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => navigate({ name: "settings", section: "connectors" })}
          className="gap-2.5 px-2.5 py-2.5 text-xs font-medium rounded-xl cursor-pointer"
        >
          <Settings className="size-4 text-muted-foreground" />
          <span>Pengaturan</span>
        </DropdownMenuItem>
        <DropdownMenuSeparator className="my-1.5" />
        <ThemeToggleMenuItem />
        <DropdownMenuSeparator className="my-1.5" />
        <DropdownMenuItem
          onClick={onLogout}
          className="gap-2.5 px-2.5 py-2.5 text-xs font-medium rounded-xl cursor-pointer text-destructive focus:bg-destructive/10 focus:text-destructive"
        >
          <LogOut className="size-4 text-destructive" />
          <span>Keluar</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
