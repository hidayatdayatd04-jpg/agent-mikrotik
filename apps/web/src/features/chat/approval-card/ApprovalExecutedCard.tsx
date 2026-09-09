import { CheckCircle2, Check, ChevronDown, ChevronUp, Archive, Copy } from "@/components/icons";
import { Button } from "@/components/ui/button";
import type { ApprovalSpec } from "../approval-card";
import type { ApprovalFlow } from "./use-approval-flow";
import type { ApprovalLogPanel } from "./use-approval-log";
import { ApprovalVerificationProof } from "./ApprovalVerificationProof";
import { ApprovalStepLog } from "./ApprovalStepLog";
import { ApprovalVerificationBar } from "./ApprovalVerificationBar";

export function ApprovalExecutedCard(props: { spec: ApprovalSpec; flow: ApprovalFlow; log: ApprovalLogPanel }) {
  const { spec, flow, log } = props;
  const isExpanded = flow.isExpanded;
  return (
    <div className="my-3 space-y-3">
      {/* 1. Executed Approval Card */}
      <div className="overflow-hidden rounded-2xl border border-emerald-500/30 bg-card shadow-xs transition-all">
        {/* Header - Clickable to expand / collapse */}
        <div
          onClick={() => flow.setIsExpanded(!isExpanded)}
          className="flex items-center justify-between gap-3 border-b border-emerald-500/20 bg-emerald-500/5 px-4 py-3 cursor-pointer hover:bg-emerald-500/10 transition-colors select-none"
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex size-7.5 shrink-0 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="size-4" />
            </div>
            <div className="min-w-0">
              <span className="text-xs font-bold text-foreground truncate block">{spec.summary}</span>
              <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium block">
                Perubahan Konfigurasi Berhasil Diterapkan & Aktif
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
              ✓ Terverifikasi & Aktif
            </span>
            <button
              type="button"
              className="flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/15 transition-colors cursor-pointer"
            >
              <span>{isExpanded ? "Sembunyikan" : "Tampilkan"}</span>
              {isExpanded ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
            </button>
          </div>
        </div>

        {/* Body content - Shown only when isExpanded is true */}
        {isExpanded && (
          <div className="p-4 space-y-3 animate-in fade-in-50 duration-200">
            {/* Success summary message */}
            <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/5 p-3 text-xs space-y-2">
              <div className="flex items-center gap-2 font-semibold text-emerald-700 dark:text-emerald-300">
                <Check className="size-4 text-emerald-500" />
                <span>Konfigurasi Selesai Diterapkan & Diverifikasi ke RouterOS</span>
              </div>
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                Semua perintah konfigurasi telah dieksekusi dan diverifikasi statusnya ke router. Konfigurasi telah aktif dan siap digunakan.
              </p>
            </div>

            <ApprovalVerificationProof spec={spec} logs={log.logs} />

            {/* Backup confirmation */}
            <div className="flex items-center gap-2 rounded-xl bg-indigo-500/5 p-2.5 text-[11px] text-indigo-700 dark:text-indigo-300 border border-indigo-500/20">
              <Archive className="size-4 shrink-0 text-indigo-500" />
              <span>Snapshot cadangan otomatis telah dibuat sebelum eksekusi untuk proteksi rollback.</span>
            </div>

            <ApprovalStepLog
              spec={spec}
              logs={log.logs}
              showLog={flow.showLog}
              onToggleLog={() => flow.setShowLog(!flow.showLog)}
              showDiff={flow.showDiff}
              onToggleDiff={() => flow.setShowDiff(!flow.showDiff)}
            />

            {/* Footer inside expanded view */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-2 text-xs text-muted-foreground">
              <div className="flex items-center gap-1.5 text-[11px] text-emerald-600 dark:text-emerald-400 font-medium">
                <Check className="size-3.5" />
                <span>Perubahan berhasil diterapkan & diverifikasi</span>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    void log.handleCopyLog();
                  }}
                  className="h-7 px-2.5 text-[11px] gap-1.5 text-muted-foreground hover:text-foreground cursor-pointer"
                >
                  {log.copiedLog ? <Check className="size-3 text-emerald-500" /> : <Copy className="size-3" />}
                  <span>{log.copiedLog ? "Tersalin!" : "Salin Detail"}</span>
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 2. Verification Section in the SAME Chat Output */}
      <ApprovalVerificationBar log={log} expanded={flow.isToolExpanded} onToggle={() => flow.setIsToolExpanded(!flow.isToolExpanded)} />
    </div>
  );
}
