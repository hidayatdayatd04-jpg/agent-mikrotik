import { ChevronDown, ChevronRight } from "@/components/icons";
import { Markdown } from "../Markdown";
import { formatDuration } from "../ToolActivity";
import type { ApprovalLogPanel } from "./use-approval-log";

export function ApprovalVerificationBar(props: { log: ApprovalLogPanel; expanded: boolean; onToggle: () => void }) {
  const { log, expanded, onToggle } = props;
  const { verification } = log;
  return (
    <div className="space-y-3 pt-0.5 animate-in fade-in duration-200">
      {/* Tool activity bar matching user interface requirement */}
      <div className="rounded-xl border border-border/70 bg-muted/30 overflow-hidden">
        <button
          type="button"
          onClick={onToggle}
          className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs cursor-pointer hover:bg-muted/50 transition-colors select-none"
          aria-expanded={expanded}
        >
          <span className="flex min-w-0 items-center gap-2 font-medium text-foreground">
            {expanded ? (
              <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
            ) : (
              <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
            )}
            <span className="truncate">{verification.toolLabel}</span>
          </span>
          <span className="flex shrink-0 items-center gap-2 text-[11px] text-muted-foreground">
            <span>{formatDuration(verification.durationMs) ?? "12 mdtk"}</span>
            <span className="font-medium text-emerald-600 dark:text-emerald-400">Selesai</span>
          </span>
        </button>

        {expanded && (
          <div className="border-t border-border/60 bg-background/60 p-2.5 space-y-2">
            <div className="flex items-center justify-between text-[10px] font-mono text-muted-foreground">
              <span className="text-cyan-600 dark:text-cyan-400 font-semibold">{verification.command}</span>
              <span className="text-emerald-600 dark:text-emerald-400 font-medium">✓ Selesai ({verification.durationMs ?? 12}ms)</span>
            </div>
            <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border/40 bg-zinc-950 p-2 font-mono text-[10.5px] text-emerald-300/90 select-all">
              {verification.output || "(Konfigurasi terverifikasi aktif pada router)"}
            </pre>
          </div>
        )}
      </div>

      {/* Verification Narrative Text */}
      <div className="text-sm leading-relaxed text-foreground">
        <Markdown text={verification.narrative} />
      </div>
    </div>
  );
}
