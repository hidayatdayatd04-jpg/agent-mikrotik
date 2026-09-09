import { X, Search } from "@/components/icons";
import { Input } from "@/components/ui/input";

export function NotificationFilters(props: {
  filterType: string;
  onFilterType: (t: string) => void;
  unreadOnly: boolean;
  onToggleUnread: () => void;
  search: string;
  onSearch: (v: string) => void;
}) {
  const { filterType, onFilterType, unreadOnly, onToggleUnread, search, onSearch } = props;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 mb-4 pb-3 border-b border-border/50">
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => onFilterType("all")}
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
          onClick={() => onFilterType("critical")}
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
          onClick={() => onFilterType("warning")}
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
          onClick={() => onFilterType("info")}
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
          onClick={() => onFilterType("success")}
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
          onClick={onToggleUnread}
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
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Cari notifikasi…"
          className="h-8 rounded-lg pl-8 text-xs border-border/60 bg-muted/30"
        />
        {search && (
          <button
            type="button"
            onClick={() => onSearch("")}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <X className="size-3" />
          </button>
        )}
      </div>
    </div>
  );
}
