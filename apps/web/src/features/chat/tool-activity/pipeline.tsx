import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, Loader2, CheckCircle2, XCircle, Clock } from "@/components/icons";
import type { PipelineStep, PipelineTx, StepStatus, RunOverall } from "./types";
import { formatDuration } from "./humanize";
import { pipelineStatus, runPipelineHeadline } from "./build";

function statusIcon(status: StepStatus) {
  if (status === "running") return <Loader2 className="size-3.5 animate-spin text-indigo-500" />;
  if (status === "completed") return <CheckCircle2 className="size-3.5 text-emerald-500" />;
  if (status === "failed") return <XCircle className="size-3.5 text-destructive" />;
  return <Clock className="size-3.5 text-muted-foreground" />;
}

const STATUS_LABEL: Record<StepStatus, string> = {
  running: "Berjalan",
  completed: "Selesai",
  failed: "Gagal",
  unknown: "Tak diketahui",
};

export function RunPipeline(props: {
  steps: PipelineStep[];
  tx?: PipelineTx[];
  defaultOpen?: boolean;
  headerRight?: ReactNode;
  live?: boolean;
  /** Status akhir run; bila failed/cancelled, headline tidak boleh "Selesai". */
  overall?: RunOverall;
}) {
  const [open, setOpen] = useState(!!props.defaultOpen);
  const [openStep, setOpenStep] = useState<string | null>(null);
  const status = props.live ? ("running" as const) : pipelineStatus(props.steps);
  const totalMs = props.steps.reduce((n, s) => n + (typeof s.durationMs === "number" ? s.durationMs : 0), 0);
  const totalLabel = totalMs > 0 ? formatDuration(totalMs) : null;
  const failed = props.steps.filter((s) => s.status === "failed").length;
  const headline = runPipelineHeadline({
    stepsCount: props.steps.length,
    txCount: props.tx?.length ?? 0,
    failedSteps: failed,
    live: props.live,
    overall: props.overall ?? null,
    steps: props.steps,
  });

  return (
    <div className="rounded-xl border border-border/70 bg-muted/30">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs"
        aria-expanded={open}
        aria-label={`${headline.text}. ${open ? "Tutup detail" : "Buka detail"}`}
      >
        <span className="flex min-w-0 items-center gap-2 font-medium">
          {open ? <ChevronDown className="size-3.5 shrink-0" /> : <ChevronRight className="size-3.5 shrink-0" />}
          <span className="truncate">{headline.text}</span>
        </span>
        <span className="flex shrink-0 items-center gap-2 text-[11px] text-muted-foreground">
          {props.headerRight}
          {totalLabel && <span>{totalLabel}</span>}
          <span
            className={
              status === "failed"
                ? "text-destructive"
                : status === "running"
                  ? "text-indigo-500"
                  : headline.tone === "bad"
                    ? "text-amber-500"
                    : "text-emerald-600 dark:text-emerald-400"
            }
          >
            {status === "done" ? "Selesai" : (STATUS_LABEL[status as StepStatus] ?? status)}
          </span>
        </span>
      </button>
      {open && (
        <ol className="space-y-1 border-t border-border/60 px-2 py-2">
          {props.steps.map((s) => {
            const isOpen = openStep === s.key;
            const dur = formatDuration(s.durationMs);
            return (
              <li key={s.key} className="rounded-lg bg-background/60">
                <button
                  type="button"
                  onClick={() => setOpenStep(isOpen ? null : s.key)}
                  className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs"
                  aria-expanded={isOpen}
                >
                  <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted font-mono text-[10px] text-muted-foreground">
                    {s.index}
                  </span>
                  {statusIcon(s.status)}
                  <span className="flex-1 truncate">{s.label}</span>
                  {dur && <span className="shrink-0 text-[11px] text-muted-foreground">{dur}</span>}
                  <span className="shrink-0 text-[11px] text-muted-foreground">{STATUS_LABEL[s.status]}</span>
                </button>
                {isOpen && (
                  <div className="mx-2 mb-2 space-y-1.5 rounded-lg border border-border/60 bg-zinc-950 p-3 font-mono text-[11px] leading-relaxed text-zinc-200">
                    <p className="font-semibold text-zinc-300">Aktivitas: {s.label}</p>
                    {s.args && (
                      <div>
                        <p className="text-zinc-500">argumen (tersanitasi):</p>
                        <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-words">{s.args}</pre>
                      </div>
                    )}
                    {s.summary ? (
                      <div>
                        <p className="text-zinc-500">output:</p>
                        <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words text-zinc-100">{s.summary}</pre>
                      </div>
                    ) : (
                      <p className="text-zinc-500">(tidak ada output teks)</p>
                    )}
                    {s.code && <p className="text-red-300">kode: {s.code}</p>}
                  </div>
                )}
              </li>
            );
          })}
          {(props.tx ?? []).map((t) => (
            <li key={t.key} className="flex items-center gap-2 rounded-lg bg-background/60 px-2.5 py-1.5 text-xs">
              <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted font-mono text-[10px] text-muted-foreground">
                S
              </span>
              {statusIcon(t.state === "committed" ? "completed" : t.state === "rolled_back" ? "failed" : "running")}
              <span className="flex-1 truncate">
                Settlement · {t.state}
                {t.reason ? ` (${t.reason})` : ""} · {t.actions} aksi
              </span>
            </li>
          ))}
          {props.steps.length === 0 && (props.tx?.length ?? 0) === 0 && (
            <li className="px-2.5 py-1.5 text-xs text-muted-foreground">Menunggu langkah pertama…</li>
          )}
        </ol>
      )}
    </div>
  );
}
