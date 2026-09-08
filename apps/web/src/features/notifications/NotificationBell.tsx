import { useState } from "react";
import { Bell, CheckCircle2, AlertCircle, TriangleAlertIcon, OctagonXIcon } from "@/components/icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  useNotifications,
  useUnreadNotificationCount,
  useMarkNotificationRead,
  useMarkAllNotificationsRead,
} from "./notification-hooks";
import { navigate, useRoute } from "@/lib/router";
import type { NotificationType } from "@shared/index";

function NotificationIcon({ type }: { type: NotificationType }) {
  switch (type) {
    case "critical":
      return <OctagonXIcon className="size-4 text-rose-500 shrink-0" />;
    case "warning":
      return <TriangleAlertIcon className="size-4 text-amber-500 shrink-0" />;
    case "success":
      return <CheckCircle2 className="size-4 text-emerald-500 shrink-0" />;
    default:
      return <AlertCircle className="size-4 text-blue-500 shrink-0" />;
  }
}

export function NotificationBell({
  collapsed = false,
  showLabel = false,
  className = "",
  onNavigate,
}: {
  collapsed?: boolean;
  showLabel?: boolean;
  className?: string;
  onNavigate?: () => void;
}) {
  const route = useRoute();
  const unreadCount = useUnreadNotificationCount();
  const { data: recentList } = useNotifications({ limit: 5 });
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();
  const [open, setOpen] = useState(false);

  const count = unreadCount.data ?? 0;
  const isNotificationsPage = route.name === "notifications";

  function goToAll() {
    setOpen(false);
    navigate({ name: "notifications" });
    onNavigate?.();
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        {showLabel ? (
          <button
            type="button"
            className={`group flex w-full items-center justify-between gap-2.5 rounded-xl border-0 px-2.5 py-2 text-left text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground transition-all cursor-pointer outline-none focus:outline-none ${
              isNotificationsPage ? "bg-accent text-foreground font-semibold" : ""
            } ${className}`}
            aria-label={`Notifikasi (${count} belum dibaca)`}
            title={count > 0 ? `${count} notifikasi baru` : "Notifikasi"}
          >
            <div className="flex items-center gap-2.5">
              <div className="relative">
                <Bell className="size-4 text-muted-foreground group-hover:text-foreground transition-transform group-hover:rotate-12 duration-200" />
                {count > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 flex size-2 rounded-full bg-rose-500" />
                )}
              </div>
              <span>Notifikasi</span>
            </div>
            {count > 0 && (
              <span className="rounded-full bg-rose-500/15 px-2 py-0.5 text-[10px] font-bold text-rose-600 dark:text-rose-400">
                {count > 99 ? "99+" : count}
              </span>
            )}
          </button>
        ) : (
          <button
            type="button"
            className={`group relative flex size-7 items-center justify-center rounded-lg border-0 text-muted-foreground hover:bg-accent hover:text-foreground transition-all duration-150 cursor-pointer outline-none focus:outline-none ${
              isNotificationsPage || open ? "bg-accent text-foreground" : ""
            } ${className}`}
            aria-label={`Notifikasi (${count} belum dibaca)`}
            title={count > 0 ? `${count} notifikasi baru` : "Notifikasi"}
          >
            <Bell
              className={`size-4 transition-transform duration-200 group-hover:rotate-12 ${
                count > 0 ? "text-foreground" : "text-muted-foreground group-hover:text-foreground"
              }`}
            />
            {count > 0 && (
              <span className="absolute -top-1 -right-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-gradient-to-tr from-rose-500 via-rose-600 to-pink-500 px-1 text-[9px] font-bold leading-none text-white">
                {count > 99 ? "99+" : count}
              </span>
            )}
          </button>
        )}
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align={collapsed ? "start" : "start"}
        side={collapsed ? "right" : "bottom"}
        sideOffset={8}
        alignOffset={collapsed ? 0 : -20}
        collisionPadding={12}
        className="w-80 rounded-2xl border border-border/60 bg-popover/95 p-2 shadow-xl backdrop-blur-md z-50"
      >
        <div className="flex items-center justify-between px-2.5 py-1.5 border-b border-border/50">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-foreground">Notifikasi</span>
            {count > 0 && (
              <span className="rounded-full bg-rose-500/10 px-2 py-0.5 text-[10px] font-semibold text-rose-600 dark:text-rose-400">
                {count} baru
              </span>
            )}
          </div>
          {count > 0 && (
            <button
              type="button"
              onClick={() => markAll.mutate()}
              className="text-[11px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
            >
              Tandai semua dibaca
            </button>
          )}
        </div>

        <div className="max-h-72 overflow-y-auto py-1 space-y-1">
          {!recentList || recentList.length === 0 ? (
            <div className="py-8 text-center space-y-1">
              <div className="flex justify-center text-muted-foreground/50">
                <Bell className="size-6 stroke-[1.5]" />
              </div>
              <p className="text-xs font-medium text-muted-foreground">Tidak ada notifikasi baru</p>
            </div>
          ) : (
            recentList.map((item) => (
              <div
                key={item.id}
                onClick={() => {
                  if (!item.read) markRead.mutate(item.id);
                }}
                className={`flex items-start gap-2.5 rounded-xl p-2.5 text-left transition-colors cursor-pointer ${
                  item.read
                    ? "opacity-65 hover:opacity-100 hover:bg-accent/40"
                    : "bg-accent/60 hover:bg-accent/90"
                }`}
              >
                <div className="pt-0.5">
                  <NotificationIcon type={item.type} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-xs font-semibold truncate text-foreground leading-tight">
                      {item.title}
                    </span>
                    <span className="text-[10px] text-muted-foreground shrink-0">
                      {new Date(item.createdAt).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </div>
                  <p className="text-[11px] text-muted-foreground line-clamp-2 mt-0.5 leading-snug">
                    {item.message}
                  </p>
                  {item.routerLabel && (
                    <span className="inline-block mt-1 text-[9px] rounded-md bg-muted px-1.5 py-0.5 font-medium text-muted-foreground">
                      {item.routerLabel}
                    </span>
                  )}
                </div>
              </div>
            ))
          )}
        </div>

        <DropdownMenuSeparator className="my-1" />
        <DropdownMenuItem
          onClick={goToAll}
          className="justify-center py-2 text-xs font-semibold text-indigo-600 dark:text-indigo-400 rounded-xl cursor-pointer hover:bg-indigo-500/10 focus:bg-indigo-500/10"
        >
          Lihat Semua Notifikasi →
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
