import { useState } from "react";
import { Scissors } from "@/components/icons";
import type { ActivityEventDTO } from "./chat-hooks";

export type { StepStatus, PipelineStep, PipelineTx, RunOverall } from "./tool-activity/types";
export {
  isManualTerminalEvent,
  isCompactionEvent,
  buildPipeline,
  pipelineStatus,
  runPipelineHeadline,
} from "./tool-activity/build";
export { humanizeTool, phaseTitle, formatDuration } from "./tool-activity/humanize";
export { RunPipeline } from "./tool-activity/pipeline";
export { ResearchCard } from "./tool-activity/research-card";

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
      {open && ok && <span className="sr-only">{`model ${String(p.model ?? "")}`}</span>}
    </div>
  );
}
