const STATUS_CONFIG: Record<string, { label: string; color: string; dot: string }> = {
  connected: {
    label: "Terhubung",
    color: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
    dot: "bg-emerald-500 animate-pulse",
  },
  connecting: {
    label: "Menghubungkan…",
    color: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30",
    dot: "bg-amber-500 animate-ping",
  },
  failed: {
    label: "Koneksi Gagal",
    color: "bg-destructive/10 text-destructive border-destructive/30",
    dot: "bg-destructive",
  },
  disconnected: {
    label: "Terputus",
    color: "bg-muted text-muted-foreground border-border",
    dot: "bg-muted-foreground",
  },
  unverified: {
    label: "Belum Terverifikasi",
    color: "bg-muted text-muted-foreground border-border",
    dot: "bg-muted-foreground",
  },
};

export function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? {
    label: status,
    color: "bg-muted text-muted-foreground border-border",
    dot: "bg-muted-foreground",
  };

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${cfg.color}`}>
      <span className={`size-1.5 rounded-full ${cfg.dot}`} />
      {cfg.label}
    </span>
  );
}
