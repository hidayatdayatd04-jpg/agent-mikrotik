import type { ActivityEventDTO, RunEventDTO } from "./chat-hooks";
import { buildPipeline, type PipelineStep } from "./ToolActivity";

export type TimelineBlock = { kind: "text"; key: string; text: string } | { kind: "tool"; key: string; step: PipelineStep };

/** One chronology for both live SSE and the persisted assistant message. */
export function buildRunTimeline(events: RunEventDTO[], live = false): TimelineBlock[] {
  const unique = [...new Map(events.map((e) => [e.seq, e])).values()].sort((a, b) => a.seq - b.seq);
  const activities: ActivityEventDTO[] = unique.map((e) => ({
    ...e, id: `event-${e.seq}`, conversationId: "", activityId: String(e.payload.callId ?? e.seq),
    parentId: null, actor: "ai", createdAt: "", payload: { ...e.payload, tool: e.payload.name ?? e.payload.tool },
  }));
  const { steps } = buildPipeline(activities, live);
  const byKey = new Map(steps.map((step) => [step.key, step]));
  const blocks: TimelineBlock[] = [];
  for (const e of unique) {
    const key = `event-${e.seq}`;
    if (e.type === "message.delta") {
      const text = String(e.payload.text ?? "");
      const last = blocks.at(-1);
      if (last?.kind === "text") last.text += text;
      else if (text) blocks.push({ kind: "text", key, text });
    } else {
      const step = byKey.get(key);
      if (step) blocks.push({ kind: "tool", key, step });
    }
  }
  return blocks;
}
