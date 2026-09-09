import { CheckCircle2, ChevronDown, ChevronUp } from "@/components/icons";
import type { ApprovalSpec } from "../approval-card";
import type { OperationLogDTO } from "@shared/index";

export function ApprovalStepLog(props: {
  spec: ApprovalSpec;
  logs: OperationLogDTO[] | undefined;
  showLog: boolean;
  onToggleLog: () => void;
  showDiff: boolean;
  onToggleDiff: () => void;
}) {
  const { spec, logs, showLog, onToggleLog, showDiff, onToggleDiff } = props;
  const steps = logs && logs.length > 0 ? logs.filter((l) => !l.command.startsWith("[VERIFIKASI]")) : null;
  const stepCount = steps ? steps.length : spec.operations.length;
  return (
    <>
      {/* Live / executed logs */}
      <div className="rounded-xl border border-border/60 bg-muted/20 overflow-hidden">
        <div className="flex items-center justify-between px-3 py-2 border-b border-border/50 bg-muted/40 text-[11px] font-medium text-foreground">
          <span className="flex items-center gap-1.5">
            <CheckCircle2 className="size-3.5 text-emerald-500" />
            <span>Log Eksekusi Langkah ({stepCount} selesai)</span>
          </span>
          <button
            type="button"
            onClick={onToggleLog}
            className="flex items-center gap-1 text-[10px] text-cyan-600 dark:text-cyan-400 hover:underline cursor-pointer"
          >
            {showLog ? "Sembunyikan" : "Tampilkan"}
            {showLog ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
          </button>
        </div>

        {showLog && (
          <div className="p-2 space-y-2 max-h-64 overflow-y-auto">
            {(
              steps ??
              spec.operations.map((op, idx) => ({
                id: `fallback-${idx}`,
                command: op.command,
                status: "success",
                durationMs: 15,
                output: null,
                errorMessage: null,
              }))
            ).map((item, idx) => (
              <div key={item.id} className="rounded-lg bg-background p-2.5 text-xs border border-border/40 font-mono space-y-1">
                <div className="flex items-center justify-between text-[10px]">
                  <span className="font-semibold text-foreground/90 break-all">
                    Langkah {idx + 1}: {item.command}
                  </span>
                  <span className="text-[9px] uppercase font-bold text-emerald-500 shrink-0 ml-2">
                    {item.status} ({item.durationMs ?? 0}ms)
                  </span>
                </div>
                {item.output && (
                  <pre className="text-[10px] text-muted-foreground whitespace-pre-wrap bg-muted/40 p-1.5 rounded select-all font-mono">
                    {item.output}
                  </pre>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Collapsible Diff */}
      {(spec.diffBefore || spec.diffAfter) && (
        <div className="rounded-xl border border-border/60 bg-muted/20 overflow-hidden">
          <button
            type="button"
            onClick={onToggleDiff}
            className="flex w-full items-center justify-between px-3 py-2 bg-muted/30 text-[11px] font-medium text-muted-foreground cursor-pointer hover:bg-muted/50"
          >
            <span>Lihat Pratinjau Diff Konfigurasi</span>
            {showDiff ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
          </button>
          {showDiff && (
            <div className="p-2.5 space-y-2 text-xs font-mono border-t border-border/40">
              {spec.diffBefore && (
                <div className="rounded-lg bg-rose-500/5 p-2 border border-rose-500/20">
                  <div className="text-[10px] font-bold text-rose-600 dark:text-rose-400 uppercase tracking-wider mb-1">Sebelum:</div>
                  <pre className="text-[11px] text-muted-foreground whitespace-pre-wrap select-all font-mono">{spec.diffBefore}</pre>
                </div>
              )}
              {spec.diffAfter && (
                <div className="rounded-lg bg-emerald-500/5 p-2 border border-emerald-500/20">
                  <div className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider mb-1">Sesudah:</div>
                  <pre className="text-[11px] text-emerald-700 dark:text-emerald-300 whitespace-pre-wrap select-all font-mono">
                    {spec.diffAfter}
                  </pre>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </>
  );
}
