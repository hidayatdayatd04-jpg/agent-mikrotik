import { Shield, ChevronDown, ChevronUp, Check, X, Loader2 } from "@/components/icons";
import { Button } from "@/components/ui/button";
import type { ApprovalSpec } from "../approval-card";
import type { ApprovalFlow } from "./use-approval-flow";
import { ApprovalOperations } from "./ApprovalOperations";

const RISK_BADGES: Record<string, { label: string; classes: string }> = {
  low: {
    label: "Risiko Rendah",
    classes: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
  },
  medium: {
    label: "Risiko Menengah",
    classes: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
  },
  high: {
    label: "Risiko Tinggi",
    classes: "bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20",
  },
  critical: {
    label: "Risiko Kritis",
    classes: "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20",
  },
};

export function ApprovalPendingCard(props: { spec: ApprovalSpec; flow: ApprovalFlow }) {
  const { spec, flow } = props;
  const { status } = flow;
  const riskBadge = RISK_BADGES[spec.riskLevel || "medium"]!;
  const isExpanded = flow.isExpanded;

  return (
    <div className="my-2.5 overflow-hidden rounded-2xl border border-border/80 bg-card shadow-xs transition-all">
      {/* Header - Clickable to expand/collapse details */}
      <div
        onClick={() => flow.setIsExpanded(!isExpanded)}
        className="flex items-center justify-between gap-3 border-b border-border/60 bg-muted/30 px-4 py-3 cursor-pointer hover:bg-muted/50 transition-colors select-none"
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="flex size-7.5 shrink-0 items-center justify-center rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400">
            <Shield className="size-4" />
          </div>
          <div className="min-w-0">
            <span className="text-xs font-bold text-foreground truncate block">{spec.summary}</span>
            <span className="text-[10px] text-muted-foreground block">Persetujuan Perubahan Konfigurasi AI</span>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className={`rounded-full border px-2.5 py-0.5 text-[10px] font-semibold ${riskBadge.classes}`}>
            {riskBadge.label}
          </span>
          <button
            type="button"
            className="flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
          >
            <span>{isExpanded ? "Sembunyikan" : "Tampilkan Detail"}</span>
            {isExpanded ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
          </button>
        </div>
      </div>

      {/* Body content - Shown only when isExpanded is true */}
      {isExpanded && (
        <div className="p-4 space-y-3.5 animate-in fade-in-50 duration-200">
          <ApprovalOperations spec={spec} executionError={flow.executionError} />
        </div>
      )}

      {/* Footer / Actions */}
      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border/60 bg-muted/10 px-4 py-3">
        {status === "idle" && (
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={flow.handleReject}
              className="h-8 gap-1.5 rounded-xl text-xs text-muted-foreground hover:text-destructive hover:bg-destructive/10 cursor-pointer"
            >
              <X className="size-3.5" />
              Tolak
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => void flow.handleApproveAndExecute()}
              className="h-8 gap-1.5 rounded-xl text-xs font-semibold bg-gradient-to-r from-blue-600 via-indigo-600 to-violet-600 text-white shadow-md shadow-indigo-500/20 hover:shadow-indigo-500/35 hover:brightness-105 cursor-pointer"
            >
              <Check className="size-3.5" />
              Setujui & Jalankan
            </Button>
          </>
        )}

        {status === "in_progress" && (
          <div className="flex items-center gap-2 text-xs font-medium text-indigo-600 dark:text-indigo-400 py-1">
            <Loader2 className="size-4 animate-spin" />
            <span>Menerapkan konfigurasi & memverifikasi status pada router…</span>
          </div>
        )}

        {status === "failed" && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-rose-500">Eksekusi gagal</span>
            <Button type="button" size="sm" variant="outline" onClick={() => void flow.handleApproveAndExecute()} className="h-7 text-xs">
              Coba Lagi
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
