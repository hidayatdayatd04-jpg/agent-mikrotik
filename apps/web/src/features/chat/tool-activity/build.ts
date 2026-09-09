import type { ActivityEventDTO } from "../chat-hooks";
import type { PipelineStep, PipelineTx, StepStatus, RunOverall } from "./types";
import { humanizeTool, phaseTitle } from "./humanize";

/** Manual terminal tests (no runId) are the user's own panel session — never part of an AI pipeline. */
export function isManualTerminalEvent(ev: ActivityEventDTO): boolean {
  return !ev.runId && ev.type.startsWith("terminal.");
}

export function isCompactionEvent(ev: ActivityEventDTO): boolean {
  return ev.type.startsWith("compaction.");
}

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
      // Deep Research (web:) dirender sebagai kartu sumber tersendiri, bukan
      // step pipeline router — lihat buildRunTimeline + ResearchCard.
      if (tool.startsWith("web:")) continue;
      const toolLabel = tool;
      const callKey = String(p.callId ?? ev.activityId);
      const step: PipelineStep = {
        key: `${ev.id}`,
        index: steps.length + 1,
        label: humanizeTool(toolLabel),
        tool,
        status: "running",
      };
      steps.push(step);
      if (!byCall.has(callKey)) byCall.set(callKey, step);
    } else if (ev.type === "tool.completed" || ev.type === "tool.failed") {
      if (String(p.tool ?? "").startsWith("web:")) continue;
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

export function runPipelineHeadline(input: {
  stepsCount: number;
  txCount: number;
  failedSteps: number;
  live?: boolean;
  overall?: RunOverall;
  steps?: PipelineStep[];
}): { text: string; tone: "ok" | "bad" | "busy" | "mute" } {
  const { stepsCount, txCount, failedSteps, live, overall, steps } = input;
  if (stepsCount === 0 && txCount === 0) return { text: "Menyiapkan pemeriksaan…", tone: "mute" };
  const phase = phaseTitle(steps ?? []);
  if (!live && overall === "failed") {
    return { text: phase, tone: "bad" };
  }
  if (!live && overall === "cancelled") {
    return { text: `${phase} · dibatalkan`, tone: "mute" };
  }
  if (live) {
    return { text: phase, tone: "busy" };
  }
  return { text: phase, tone: failedSteps > 0 ? "bad" : "ok" };
}
