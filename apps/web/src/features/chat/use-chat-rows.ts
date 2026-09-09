import type { MessageDTO, ActivityEventDTO } from "./chat-hooks";
import { humanizeTool, type PipelineStep } from "./ToolActivity";
import { isCompactionEvent, isManualTerminalEvent } from "./ToolActivity";

export type ChatRow = { kind: "message"; m: MessageDTO } | { kind: "compaction"; ev: ActivityEventDTO };

export interface ToolActivityLike {
  id?: string;
  name: string;
  status: "running" | "done" | "failed";
}

export function useChatRows(messages: MessageDTO[], persistedActivities: ActivityEventDTO[], toolActivity: ToolActivityLike[]) {
  // Group persisted run events by runId. Manual terminal sessions (no runId)
  // belong to the terminal panel, never to an AI pipeline. Compaction notices
  // render as standalone system rows interleaved by time.
  const persisted = persistedActivities;
  const byRun = new Map<string, ActivityEventDTO[]>();
  for (const ev of persisted) {
    if (ev.type === "run.started" || isManualTerminalEvent(ev) || isCompactionEvent(ev)) continue;
    if (!ev.runId) continue;
    const arr = byRun.get(ev.runId);
    if (arr) arr.push(ev);
    else byRun.set(ev.runId, [ev]);
  }
  const compactions = persisted
    .filter((ev) => isCompactionEvent(ev))
    .slice()
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  const rows: ChatRow[] = [];
  let ci = 0;
  for (const m of messages) {
    while (ci < compactions.length && compactions[ci]!.createdAt <= m.createdAt) {
      rows.push({ kind: "compaction", ev: compactions[ci]! });
      ci += 1;
    }
    rows.push({ kind: "message", m });
  }
  while (ci < compactions.length) {
    rows.push({ kind: "compaction", ev: compactions[ci]! });
    ci += 1;
  }

  // Deep Research (web:) punya kartu hasil sendiri — bukan step pipeline live.
  const liveSteps: PipelineStep[] = toolActivity
    .filter((t) => !t.name.startsWith("web:"))
    .map((t, i) => ({
      key: t.id ?? `live-${i}`,
      index: i + 1,
      label: humanizeTool(t.name),
      tool: t.name,
      status: t.status === "done" ? "completed" : t.status,
      durationMs: null,
    }));

  return { rows, byRun, liveSteps };
}
