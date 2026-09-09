import { X, ChevronDown, ChevronUp } from "@/components/icons";
import type { ApprovalSpec } from "../approval-card";

export function ApprovalRejectedCard(props: { spec: ApprovalSpec; expanded: boolean; onToggle: () => void }) {
  const { spec, expanded, onToggle } = props;
  return (
    <div className="my-2.5 overflow-hidden rounded-2xl border border-border/80 bg-card shadow-xs transition-all opacity-85">
      <div
        onClick={onToggle}
        className="flex items-center justify-between gap-3 border-b border-border/60 bg-muted/30 px-4 py-3 cursor-pointer hover:bg-muted/50 transition-colors select-none"
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="flex size-7.5 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
            <X className="size-4" />
          </div>
          <div className="min-w-0">
            <span className="text-xs font-bold text-foreground truncate block">{spec.summary}</span>
            <span className="text-[10px] text-muted-foreground block">Persetujuan Perubahan Konfigurasi AI</span>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="rounded-full border border-border px-2.5 py-0.5 text-[10px] font-semibold text-muted-foreground bg-muted">
            Dibatalkan
          </span>
          <button
            type="button"
            className="flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
          >
            <span>{expanded ? "Sembunyikan" : "Tampilkan"}</span>
            {expanded ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
          </button>
        </div>
      </div>
      {expanded && (
        <div className="p-4 text-xs text-muted-foreground animate-in fade-in-50 duration-200">
          Perubahan konfigurasi ini dibatalkan oleh pengguna. Router tetap dalam kondisi semula dan tidak ada konfigurasi yang diubah.
        </div>
      )}
    </div>
  );
}
