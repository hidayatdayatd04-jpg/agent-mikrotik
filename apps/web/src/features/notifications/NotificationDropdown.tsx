import { Bell } from "@/components/icons";
import { DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { useMarkNotificationRead, useMarkAllNotificationsRead } from "./notification-hooks";
import { NotificationIcon } from "./NotificationIcon";

export function NotificationDropdown(props: {
  recentList: { id: string; title: string; message: string; type: "critical" | "warning" | "success" | "info"; read: boolean; createdAt: string; routerLabel?: string | null }[] | undefined;
  count: number;
  onViewAll: () => void;
}) {
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();
  const { recentList, count } = props;

  return (
    <>
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
                item.read ? "opacity-65 hover:opacity-100 hover:bg-accent/40" : "bg-accent/60 hover:bg-accent/90"
              }`}
            >
              <div className="pt-0.5">
                <NotificationIcon type={item.type} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-1">
                  <span className="text-xs font-semibold truncate text-foreground leading-tight">{item.title}</span>
                  <span className="text-[10px] text-muted-foreground shrink-0">
                    {new Date(item.createdAt).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground line-clamp-2 mt-0.5 leading-snug">{item.message}</p>
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
        onClick={props.onViewAll}
        className="justify-center py-2 text-xs font-semibold text-indigo-600 dark:text-indigo-400 rounded-xl cursor-pointer hover:bg-indigo-500/10 focus:bg-indigo-500/10"
      >
        Lihat Semua Notifikasi →
      </DropdownMenuItem>
    </>
  );
}
