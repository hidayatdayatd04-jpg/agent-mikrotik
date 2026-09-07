import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, Loader2, CheckCircle2, XCircle, Clock, Scissors } from "lucide-react";
import type { ActivityEventDTO } from "./chat-hooks";

export type StepStatus = "running" | "completed" | "failed" | "unknown";

export interface PipelineStep {
  key: string;
  index: number;
  label: string;
  tool: string;
  status: StepStatus;
  durationMs?: number | null;
  summary?: string;
  code?: string;
  args?: string;
}

export interface PipelineTx {
  key: string;
  state: string;
  actions: number;
  reason?: string | null;
}

/** Manual terminal tests (no runId) are the user's own panel session — never part of an AI pipeline. */
export function isManualTerminalEvent(ev: ActivityEventDTO): boolean {
  return !ev.runId && ev.type.startsWith("terminal.");
}

export function isCompactionEvent(ev: ActivityEventDTO): boolean {
  return ev.type.startsWith("compaction.");
}

export function humanizeTool(name: string): string {
  const n = name.toLowerCase();
  if (n.includes("check_connection")) return "Memeriksa status koneksi";
  if (n.includes("identity")) return "Memeriksa koneksi & identitas";
  if (n.includes("terminal") || n.includes("exec") || n.includes("run_routeros") || n.includes("command")) {
    return "Menjalankan perintah RouterOS";
  }
  if (n.includes("verify") || n.includes("safe_mode_status")) return "Verifikasi Safe Mode";
  if (n.startsWith("docs:")) return "Mencari dokumentasi";
  const short = name.includes(":") ? name.split(":").slice(1).join(":") : name;
  return short.replace(/_/g, " ").slice(0, 48) || name;
}

export function formatDuration(ms: number | null | undefined): string | null {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0) return null;
  if (ms < 1000) return `${Math.round(ms)} mdtk`;
  return `${new Intl.NumberFormat("id-ID", { maximumFractionDigits: 1 }).format(ms / 1000)} dtk`;
}

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

/** Pair tool.started/completed/failed by callId into ordered steps; collect tx stages. */
export function buildPipeline(events: ActivityEventDTO[], live = false): { steps: PipelineStep[]; tx: PipelineTx[] } {
  const steps: PipelineStep[] = [];
  const byCall = new Map<string, PipelineStep>();
  const tx: PipelineTx[] = [];
  const ordered = events.slice().sort((a, b) => a.seq - b.seq);
  for (const ev of ordered) {
    const p = ev.payload as Record<string, unknown>;
    if (ev.type === "tool.started") {
      const tool = String(p.tool ?? "tool");
      const callKey = String(p.callId ?? ev.activityId);
      const step: PipelineStep = {
        key: `${ev.id}`,
        index: steps.length + 1,
        label: humanizeTool(tool),
        tool,
        status: "running",
      };
      steps.push(step);
      if (!byCall.has(callKey)) byCall.set(callKey, step);
    } else if (ev.type === "tool.completed" || ev.type === "tool.failed") {
      const callKey = String(p.callId ?? ev.activityId);
      let step = byCall.get(callKey);
      if (!step) {
        for (let i = steps.length - 1; i >= 0; i--) {
          if (steps[i]!.status === "running") {
            step = steps[i]!;
            break;
          }
        }
      }
      const summary = String(p.summary ?? p.message ?? p.outputPreview ?? "");
      if (step) {
        step.status = ev.type === "tool.completed" ? "completed" : "failed";
        if (summary) step.summary = summary.slice(0, 2000);
        const code = String(p.code ?? p.errorCode ?? "");
        if (code) step.code = code;
        if (typeof p.durationMs === "number") step.durationMs = p.durationMs;
        if (typeof p.args === "string" && p.args) step.args = p.args;
      } else {
        const tool = String(p.tool ?? "tool");
        steps.push({
          key: `${ev.id}`,
          index: steps.length + 1,
          label: humanizeTool(tool),
          tool,
          status: ev.type === "tool.completed" ? "completed" : "failed",
          durationMs: typeof p.durationMs === "number" ? p.durationMs : null,
          summary: summary ? summary.slice(0, 2000) : undefined,
          code: String(p.code ?? p.errorCode ?? "") || undefined,
          args: typeof p.args === "string" && p.args ? p.args : undefined,
        });
      }
    } else if (ev.type === "transaction.updated") {
      tx.push({
        key: `${ev.id}`,
        state: String(p.state ?? "unknown"),
        actions: Number(p.actions ?? 0),
        reason: typeof p.reason === "string" ? p.reason : null,
      });
    }
  }
  for (const s of steps) {
    if (s.status === "running" && !live) s.status = "unknown";
  }
  return { steps, tx };
}

export function pipelineStatus(steps: PipelineStep[]): StepStatus | "done" {
  if (steps.some((s) => s.status === "running")) return "running";
  if (steps.some((s) => s.status === "failed")) return "failed";
  if (steps.some((s) => s.status === "unknown")) return "unknown";
  return "done";
}

/** Status run keseluruhan (bukan hanya langkah tool) untuk headline jujur. */
export type RunOverall = "completed" | "failed" | "cancelled" | null;

export function runPipelineHeadline(input: {
  stepsCount: number;
  txCount: number;
  failedSteps: number;
  live?: boolean;
  overall?: RunOverall;
}): { text: string; tone: "ok" | "bad" | "busy" | "mute" } {
  const { stepsCount, txCount, failedSteps, live, overall } = input;
  if (stepsCount === 0 && txCount === 0) return { text: "Menyiapkan proses…", tone: "mute" };
  // Run gagal/dibatalkan tidak boleh berlabel "Selesai" walau tool-nya selesai.
  if (!live && overall === "failed") {
    return { text: `Proses · ${stepsCount} langkah · jawaban gagal`, tone: "bad" };
  }
  if (!live && overall === "cancelled") {
    return { text: `Proses · ${stepsCount} langkah · dibatalkan`, tone: "mute" };
  }
  return { text: `Proses · ${stepsCount} langkah${failedSteps > 0 ? ` · ${failedSteps} gagal` : ""}`, tone: failedSteps > 0 ? "bad" : "ok" };
}

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
  });

  return (
    <div className="rounded-xl border border-border/70 bg-muted/30">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs"
        aria-expanded={open}
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
              status === "failed" || headline.tone === "bad"
                ? "text-destructive"
                : status === "running"
                  ? "text-indigo-500"
                  : "text-emerald-600 dark:text-emerald-400"
            }
          >
            {headline.tone === "bad" && status === "done" ? "Gagal" : status === "done" ? "Selesai" : STATUS_LABEL[status as StepStatus] ?? status}
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
                    <p className="break-all text-zinc-400">tool: {s.tool}</p>
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

export function CompactionNotice(props: { event: ActivityEventDTO }) {
  const [open, setOpen] = useState(false);
  const p = props.event.payload as Record<string, unknown>;
  const ok = props.event.type === "compaction.completed";
  const detail = ok
    ? `ringkasan v${String(p.version ?? "?")} · throughSeq ${String(p.throughSeq ?? "?")}`
    : `dapat dicoba ulang · ${String(p.error ?? p.code ?? "")}`.slice(0, 120);
  return (
    <div className="flex justify-center">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex max-w-full items-center gap-1.5 rounded-full border border-border/60 bg-muted/40 px-3 py-1 text-[11px] text-muted-foreground hover:text-foreground"
        aria-expanded={open}
      >
        <Scissors className="size-3" />
        <span className="truncate">
          {ok ? "Konteks diringkas; percakapan dilanjutkan" : "Compact gagal"} · {detail}
        </span>
      </button>
      {open && ok && (
        <span className="sr-only">{`model ${String(p.model ?? "")}`}</span>
      )}
    </div>
  );
}
