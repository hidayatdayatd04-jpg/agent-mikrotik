import { Archive, AlertCircle } from "@/components/icons";
import type { ApprovalSpec } from "../approval-card";

export function ApprovalOperations(props: { spec: ApprovalSpec; executionError: string | null }) {
  const { spec, executionError } = props;
  return (
    <>
      {spec.impactDescription && <p className="text-xs leading-relaxed text-muted-foreground">{spec.impactDescription}</p>}

      {/* Affected Objects */}
      {spec.affectedObjects && spec.affectedObjects.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] font-medium text-muted-foreground mr-1">Terdampak:</span>
          {spec.affectedObjects.map((obj, i) => (
            <span
              key={i}
              className="rounded-md bg-muted px-2 py-0.5 font-mono text-[10px] text-foreground/80 border border-border/50"
            >
              {obj}
            </span>
          ))}
        </div>
      )}

      {/* Operations list preview */}
      <div className="rounded-xl border border-border/60 bg-muted/20 overflow-hidden">
        <div className="px-3 py-2 border-b border-border/50 bg-muted/40 text-[11px] font-medium text-muted-foreground">
          <span>Daftar Perintah ({spec.operations.length} langkah)</span>
        </div>

        <div className="p-2 space-y-2">
          {spec.operations.map((op, i) => (
            <div key={i} className="rounded-lg bg-background p-2 text-xs border border-border/40 space-y-1">
              <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                <span className="font-semibold text-foreground/80">
                  Langkah {i + 1}: {op.description || "Perintah RouterOS"}
                </span>
                {op.risk && (
                  <span
                    className={`uppercase text-[9px] font-mono font-bold ${
                      op.risk === "destructive" ? "text-rose-500" : op.risk === "write" ? "text-amber-500" : "text-muted-foreground"
                    }`}
                  >
                    {op.risk}
                  </span>
                )}
              </div>
              <div className="rounded bg-muted/50 px-2 py-1 font-mono text-[11px] text-foreground select-all break-all">
                {op.command}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Diff Preview if present */}
      {(spec.diffBefore || spec.diffAfter) && (
        <div className="rounded-xl border border-border/60 bg-muted/20 overflow-hidden">
          <div className="px-3 py-2 border-b border-border/50 bg-muted/40 text-[11px] font-medium text-muted-foreground flex items-center justify-between">
            <span>Pratinjau Diff Konfigurasi</span>
            <span className="text-[10px] text-muted-foreground">Sebelum vs Sesudah</span>
          </div>
          <div className="p-2.5 space-y-2 text-xs font-mono">
            {spec.diffBefore && (
              <div className="rounded-lg bg-rose-500/5 p-2 border border-rose-500/20">
                <div className="text-[10px] font-bold text-rose-600 dark:text-rose-400 uppercase tracking-wider mb-1">
                  Sebelum (Existing):
                </div>
                <pre className="text-[11px] text-muted-foreground whitespace-pre-wrap select-all font-mono leading-relaxed">
                  {spec.diffBefore}
                </pre>
              </div>
            )}
            {spec.diffAfter && (
              <div className="rounded-lg bg-emerald-500/5 p-2 border border-emerald-500/20">
                <div className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider mb-1">
                  Sesudah (Rencana Perubahan):
                </div>
                <pre className="text-[11px] text-emerald-700 dark:text-emerald-300 whitespace-pre-wrap select-all font-mono leading-relaxed">
                  {spec.diffAfter}
                </pre>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Protection assurance */}
      <div className="flex items-center gap-2 rounded-xl bg-indigo-500/5 p-2.5 text-[11px] text-indigo-700 dark:text-indigo-300 border border-indigo-500/20">
        <Archive className="size-4 shrink-0 text-indigo-500" />
        <span>Snapshot konfigurasi otomatis akan dibuat sebelum eksekusi dimulai untuk keamanan rollback.</span>
      </div>

      {/* Execution error notice if any */}
      {executionError && (
        <div className="flex items-start gap-2 rounded-xl bg-rose-500/10 p-2.5 text-xs text-rose-600 dark:text-rose-400 border border-rose-500/20">
          <AlertCircle className="size-4 shrink-0 mt-0.5" />
          <div className="flex-1">{executionError}</div>
        </div>
      )}
    </>
  );
}
