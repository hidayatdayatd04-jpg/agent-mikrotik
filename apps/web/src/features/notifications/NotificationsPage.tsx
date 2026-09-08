import { useState } from "react";
import {
  Bell,
  Check,
  Trash2,
  CheckCircle2,
  AlertCircle,
  TriangleAlertIcon,
  OctagonXIcon,
  Settings,
  X,
  Search,
} from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  useNotifications,
  useMarkNotificationRead,
  useMarkAllNotificationsRead,
  useDeleteNotification,
  useNotificationSettings,
  useUpdateNotificationSettings,
} from "./notification-hooks";
import type { NotificationDTO } from "@shared/index";

export default function NotificationsPage() {
  const [filterType, setFilterType] = useState<string>("all");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [search, setSearch] = useState("");
  const [showSettings, setShowSettings] = useState(false);

  const { data: items, isLoading, isError } = useNotifications({ limit: 100 });
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();
  const deleteNotif = useDeleteNotification();

  const settings = useNotificationSettings();
  const updateSettings = useUpdateNotificationSettings();

  const filtered = (items ?? []).filter((item) => {
    if (unreadOnly && item.read) return false;
    if (filterType !== "all" && item.type !== filterType) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      return (
        item.title.toLowerCase().includes(q) ||
        item.message.toLowerCase().includes(q) ||
        (item.routerLabel?.toLowerCase().includes(q) ?? false)
      );
    }
    return true;
  });

  const unreadCount = (items ?? []).filter((i) => !i.read).length;

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
          {/* Filters Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4 pb-3 border-b border-border/50">
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => setFilterType("all")}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                  filterType === "all"
                    ? "bg-primary text-primary-foreground font-semibold"
                    : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                Semua
              </button>
              <button
                type="button"
                onClick={() => setFilterType("critical")}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                  filterType === "critical"
                    ? "bg-rose-500 text-white font-semibold"
                    : "bg-rose-500/10 text-rose-600 dark:text-rose-400 hover:bg-rose-500/20"
                }`}
              >
                Kritis
              </button>
              <button
                type="button"
                onClick={() => setFilterType("warning")}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                  filterType === "warning"
                    ? "bg-amber-500 text-white font-semibold"
                    : "bg-amber-500/10 text-amber-600 dark:text-amber-400 hover:bg-amber-500/20"
                }`}
              >
                Peringatan
              </button>
              <button
                type="button"
                onClick={() => setFilterType("info")}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                  filterType === "info"
                    ? "bg-blue-500 text-white font-semibold"
                    : "bg-blue-500/10 text-blue-600 dark:text-blue-400 hover:bg-blue-500/20"
                }`}
              >
                Info
              </button>
              <button
                type="button"
                onClick={() => setFilterType("success")}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                  filterType === "success"
                    ? "bg-emerald-500 text-white font-semibold"
                    : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20"
                }`}
              >
                Sukses
              </button>

              <div className="h-4 w-px bg-border/60 mx-1" />

              <button
                type="button"
                onClick={() => setUnreadOnly(!unreadOnly)}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium border transition-colors cursor-pointer ${
                  unreadOnly
                    ? "border-indigo-500 bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 font-semibold"
                    : "border-border/60 text-muted-foreground hover:bg-muted/40"
                }`}
              >
                Hanya Belum Dibaca
              </button>
            </div>

            {/* Search Input */}
            <div className="relative w-64">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/70" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Cari notifikasi…"
                className="h-8 rounded-lg pl-8 text-xs border-border/60 bg-muted/30"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="size-3" />
                </button>
              )}
            </div>
          </div>

          {/* List Content */}
          <div className="flex-1 overflow-y-auto pr-1 space-y-2.5">
            {isLoading && (
              <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
                Memuat notifikasi…
              </div>
            )}
            {isError && (
              <div className="flex h-40 items-center justify-center text-sm text-destructive">
                Gagal memuat notifikasi.
              </div>
            )}
            {!isLoading && filtered.length === 0 && (
              <div className="flex flex-col items-center justify-center h-64 text-center">
                <div className="flex size-14 items-center justify-center rounded-2xl bg-muted/40 text-muted-foreground mb-3">
                  <Bell className="size-6 opacity-60" />
                </div>
                <p className="text-sm font-semibold text-foreground">Tidak Ada Notifikasi</p>
                <p className="text-xs text-muted-foreground mt-1 max-w-sm">
                  {unreadOnly || filterType !== "all" || search
                    ? "Tidak ada notifikasi yang cocok dengan filter aktif."
                    : "Semua sistem router Anda berjalan optimal tanpa kendala."}
                </p>
              </div>
            )}

            {filtered.map((item) => (
              <NotificationCard
                key={item.id}
                item={item}
                onRead={() => markRead.mutate(item.id)}
                onDelete={() => deleteNotif.mutate(item.id)}
              />
            ))}
          </div>
        </div>

        {/* Optional Settings Slide-out panel */}
        {showSettings && (
          <aside className="w-80 border-l border-border/60 bg-sidebar/50 p-5 overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-border/50">
              <h2 className="text-sm font-bold">Pengaturan Ambang Batas</h2>
              <button
                type="button"
                onClick={() => setShowSettings(false)}
                className="text-muted-foreground hover:text-foreground p-1"
              >
                <X className="size-4" />
              </button>
            </div>

            <div className="mt-4 space-y-4 text-xs">
              <div>
                <label className="block font-semibold mb-1">Ambang CPU (Warning/Kritis)</label>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min={10}
                    max={100}
                    defaultValue={settings.data?.cpuThreshold ?? 90}
                    className="h-8 text-xs"
                    id="cpu-threshold-input"
                  />
                  <span className="text-muted-foreground">%</span>
                </div>
                <p className="text-[11px] text-muted-foreground mt-1">Alert dipicu jika beban CPU melebihi nilai ini.</p>
              </div>

              <div>
                <label className="block font-semibold mb-1">Ambang RAM (Memory)</label>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min={10}
                    max={100}
                    defaultValue={settings.data?.ramThreshold ?? 85}
                    className="h-8 text-xs"
                    id="ram-threshold-input"
                  />
                  <span className="text-muted-foreground">%</span>
                </div>
                <p className="text-[11px] text-muted-foreground mt-1">Alert dipicu jika penggunaan RAM melebihi nilai ini.</p>
              </div>

              <div>
                <label className="block font-semibold mb-1">Cooldown Deduplikasi</label>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min={1}
                    max={60}
                    defaultValue={Math.round((settings.data?.cooldownMs ?? 300_000) / 60_000)}
                    className="h-8 text-xs"
                    id="cooldown-input"
                  />
                  <span className="text-muted-foreground">menit</span>
                </div>
                <p className="text-[11px] text-muted-foreground mt-1">Jeda minimum agar alert yang sama tidak berulang.</p>
              </div>

              <Button
                size="sm"
                className="w-full mt-4 cursor-pointer"
                onClick={() => {
                  const cpu = parseInt((document.getElementById("cpu-threshold-input") as HTMLInputElement)?.value ?? "90", 10);
                  const ram = parseInt((document.getElementById("ram-threshold-input") as HTMLInputElement)?.value ?? "85", 10);
                  const cd = parseInt((document.getElementById("cooldown-input") as HTMLInputElement)?.value ?? "5", 10) * 60_000;
                  updateSettings.mutate({ cpuThreshold: cpu, ramThreshold: ram, cooldownMs: cd });
                }}
              >
                Simpan Preferensi
              </Button>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}

function NotificationCard({
  item,
  onRead,
  onDelete,
}: {
  item: NotificationDTO;
  onRead: () => void;
  onDelete: () => void;
}) {
  const typeStyles = {
    critical: "border-l-4 border-l-rose-500 bg-rose-500/5 hover:bg-rose-500/10",
    warning: "border-l-4 border-l-amber-500 bg-amber-500/5 hover:bg-amber-500/10",
    success: "border-l-4 border-l-emerald-500 bg-emerald-500/5 hover:bg-emerald-500/10",
    info: "border-l-4 border-l-blue-500 bg-blue-500/5 hover:bg-blue-500/10",
  }[item.type];

  return (
    <div
      className={`group flex items-start justify-between gap-4 rounded-xl border border-border/50 p-3.5 transition-all ${typeStyles} ${
        item.read ? "opacity-75" : "shadow-xs"
      }`}
    >
      <div className="flex items-start gap-3 min-w-0 flex-1">
        <div className="pt-0.5 shrink-0">
          {item.type === "critical" && <OctagonXIcon className="size-4.5 text-rose-500" />}
          {item.type === "warning" && <TriangleAlertIcon className="size-4.5 text-amber-500" />}
          {item.type === "success" && <CheckCircle2 className="size-4.5 text-emerald-500" />}
          {item.type === "info" && <AlertCircle className="size-4.5 text-blue-500" />}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`text-xs font-semibold ${item.read ? "text-foreground/80" : "text-foreground"}`}>
              {item.title}
            </span>
            {item.routerLabel && (
              <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                {item.routerLabel}
              </span>
            )}
            <span className="text-[10px] text-muted-foreground">
              {new Date(item.createdAt).toLocaleString("id-ID", {
                day: "numeric",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
            {!item.read && (
              <span className="rounded-full bg-primary/20 px-1.5 py-0.2 text-[9px] font-bold text-primary">
                BARU
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-1 leading-relaxed whitespace-pre-wrap">
            {item.message}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
        {!item.read && (
          <Button
            size="icon"
            variant="ghost"
            className="size-7 rounded-lg text-muted-foreground hover:text-foreground cursor-pointer"
            onClick={onRead}
            title="Tandai telah dibaca"
          >
            <Check className="size-3.5" />
          </Button>
        )}
        <Button
          size="icon"
          variant="ghost"
          className="size-7 rounded-lg text-muted-foreground hover:text-destructive cursor-pointer"
          onClick={onDelete}
          title="Hapus notifikasi"
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}
