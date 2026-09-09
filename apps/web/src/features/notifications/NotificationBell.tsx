import { useState } from "react";
import { Bell } from "@/components/icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  useNotifications,
  useUnreadNotificationCount,
} from "./notification-hooks";
import { navigate, useRoute } from "@/lib/router";
import { NotificationDropdown } from "./NotificationDropdown";

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
        <NotificationDropdown recentList={recentList} count={count} onViewAll={goToAll} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
