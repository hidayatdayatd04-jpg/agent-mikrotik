import type { ResearchResult } from "@shared/index";
import type { ActivityEventDTO, RunEventDTO } from "./chat-hooks";
import { buildPipeline, type PipelineStep } from "./ToolActivity";

export type TimelineBlock =
  | { kind: "text"; key: string; text: string }
  | { kind: "tool"; key: string; step: PipelineStep; steps: PipelineStep[] }
  | {
      kind: "research";
      key: string;
      callId: string;
      status: "running" | "completed" | "failed";
      research: ResearchResult | null;
    };

/** One chronology for both live SSE and the persisted assistant message. */
export function buildRunTimeline(events: RunEventDTO[], live = false): TimelineBlock[] {
  const unique = [...new Map(events.map((e) => [e.seq, e])).values()].sort((a, b) => a.seq - b.seq);
  const activities: ActivityEventDTO[] = unique.map((e) => ({
    ...e,
    id: `event-${e.seq}`,
    conversationId: "",
    activityId: String(e.payload.callId ?? e.seq),
    parentId: null,
    actor: "ai",
    createdAt: "",
    payload: { ...e.payload, tool: e.payload.name ?? e.payload.tool },
  }));
  const { steps } = buildPipeline(activities, live);
  const byKey = new Map(steps.map((step) => [step.key, step]));
  const blocks: TimelineBlock[] = [];
  const researchByCall = new Map<string, Extract<TimelineBlock, { kind: "research" }>>();

  for (const e of unique) {
    const key = `event-${e.seq}`;
    if (e.type === "message.delta") {
      const text = String(e.payload.text ?? "");
      const last = blocks.at(-1);
      if (last?.kind === "text") {
        last.text += text;
      } else if (text) {
        blocks.push({ kind: "text", key, text });
      }
      continue;
    }
    const p = e.payload as Record<string, unknown>;
    const tool = String(p.tool ?? p.name ?? "");
    // Deep Research (web:) tidak masuk pipeline router — dirender sebagai
    // kartu sumber tersendiri (ResearchCard) pada posisi kronologisnya.
    if (tool.startsWith("web:")) {
      const callId = String(p.callId ?? key);
      if (e.type === "tool.started") {
        const block: TimelineBlock = { kind: "research", key, callId, status: "running", research: null };
        researchByCall.set(callId, block);
        blocks.push(block);
      } else if (e.type === "tool.completed" || e.type === "tool.failed") {
        const research = p.research && typeof p.research === "object" ? (p.research as ResearchResult) : null;
        const status = e.type === "tool.completed" ? ("completed" as const) : ("failed" as const);
        const existing = researchByCall.get(callId);
        if (existing) {
          existing.status = status;
          existing.research = research;
        } else {
          const block: TimelineBlock = { kind: "research", key, callId, status, research };
          researchByCall.set(callId, block);
          blocks.push(block);
        }
      }
      continue;
    }
    const step = byKey.get(key);
    if (step) {
      const last = blocks.at(-1);
      if (last?.kind === "tool") {
        if (!last.steps.some((s) => s.key === step.key)) {
          last.steps.push(step);
        }
      } else {
        blocks.push({ kind: "tool", key, step, steps: [step] });
      }
    }
  }
  return blocks;
}
