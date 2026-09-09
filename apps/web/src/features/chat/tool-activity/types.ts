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

/** Status run keseluruhan (bukan hanya langkah tool) untuk headline jujur. */
export type RunOverall = "completed" | "failed" | "cancelled" | null;
