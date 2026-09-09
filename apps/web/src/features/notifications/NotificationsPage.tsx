import { useState } from "react";
import { Bell, Check, Settings } from "@/components/icons";
import { Button } from "@/components/ui/button";
import {
  useNotifications,
  useMarkNotificationRead,
  useMarkAllNotificationsRead,
  useDeleteNotification,
  useNotificationSettings,
  useUpdateNotificationSettings,
} from "./notification-hooks";
import { useNotificationFilter } from "./use-notification-filter";
import { NotificationFilters } from "./NotificationFilters";
import { NotificationSettingsPanel } from "./NotificationSettingsPanel";
import { NotificationCard } from "./NotificationCard";

export default function NotificationsPage() {
  const [showSettings, setShowSettings] = useState(false);

  const { data: items, isLoading, isError } = useNotifications({ limit: 100 });
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();
  const deleteNotif = useDeleteNotification();

  const settings = useNotificationSettings();
  const updateSettings = useUpdateNotificationSettings();
  const filter = useNotificationFilter(items);
  const { filtered, unreadCount } = filter;

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background text-foreground">
      {/* Top Header */}
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-border/60 bg-background/80 px-6 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
            <Bell className="size-5" />
          </div>
          <div>
            <h1 className="text-base font-bold leading-tight">Pusat Notifikasi</h1>
            <p className="text-xs text-muted-foreground">
              {unreadCount > 0 ? `${unreadCount} notifikasi belum dibaca` : "Semua notifikasi telah dibaca"}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {unreadCount > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => markAll.mutate()}
              className="gap-1.5 text-xs h-8 rounded-lg cursor-pointer"
            >
              <Check className="size-3.5" />
              Tandai Semua Dibaca
            </Button>
          )}
          <Button
            variant={showSettings ? "default" : "outline"}
            size="sm"
            onClick={() => setShowSettings(!showSettings)}
            className="gap-1.5 text-xs h-8 rounded-lg cursor-pointer"
          >
            <Settings className="size-3.5" />
            Pengaturan Alert
          </Button>
        </div>
      </header>

      {/* Main Content Area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Notifications List Area */}
        <div className="flex flex-1 flex-col overflow-hidden p-6 max-w-5xl mx-auto w-full">
          <NotificationFilters
            filterType={filter.filterType}
            onFilterType={filter.setFilterType}
            unreadOnly={filter.unreadOnly}
            onToggleUnread={() => filter.setUnreadOnly((v) => !v)}
            search={filter.search}
            onSearch={filter.setSearch}
          />

          {/* List Content */}
          <div className="flex-1 overflow-y-auto pr-1 space-y-2.5">
            {isLoading && (
              <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">Memuat notifikasi…</div>
            )}
            {isError && (
              <div className="flex h-40 items-center justify-center text-sm text-destructive">Gagal memuat notifikasi.</div>
            )}
            {!isLoading && filtered.length === 0 && (
              <div className="flex flex-col items-center justify-center h-64 text-center">
                <div className="flex size-14 items-center justify-center rounded-2xl bg-muted/40 text-muted-foreground mb-3">
                  <Bell className="size-6 opacity-60" />
                </div>
                <p className="text-sm font-semibold text-foreground">Tidak Ada Notifikasi</p>
                <p className="text-xs text-muted-foreground mt-1 max-w-sm">
                  {filter.unreadOnly || filter.filterType !== "all" || filter.search
                    ? "Tidak ada notifikasi yang cocok dengan filter aktif."
                    : "Semua sistem router Anda berjalan optimal tanpa kendala."}
                </p>
              </div>
            )}

            {filtered.map((item) => (
              <NotificationCard key={item.id} item={item} onRead={() => markRead.mutate(item.id)} onDelete={() => deleteNotif.mutate(item.id)} />
            ))}
          </div>
        </div>

        {/* Optional Settings Slide-out panel */}
        {showSettings && (
          <NotificationSettingsPanel settings={settings} updateSettings={updateSettings} onClose={() => setShowSettings(false)} />
        )}
      </div>
    </div>
  );
}
