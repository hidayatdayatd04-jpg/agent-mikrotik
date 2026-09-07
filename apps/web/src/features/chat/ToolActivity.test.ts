import { describe, expect, test } from "vitest";
import {
  buildPipeline,
  formatDuration,
  humanizeTool,
  isCompactionEvent,
  isManualTerminalEvent,
} from "./ToolActivity";
import type { ActivityEventDTO } from "./chat-hooks";

function ev(partial: Partial<ActivityEventDTO> & { type: string }): ActivityEventDTO {
  return {
    id: `e-${Math.random().toString(36).slice(2)}`,
    conversationId: "conv-1",
    runId: "run-1",
    activityId: "act-1",
    parentId: null,
    seq: 1,
    actor: "ai",
    payload: {},
    createdAt: new Date().toISOString(),
    ...partial,
  } as ActivityEventDTO;
}

describe("pipeline pairing", () => {
  test("started + completed menjadi 1 langkah selesai dengan output", () => {
    const { steps, tx } = buildPipeline([
      ev({ seq: 1, type: "tool.started", payload: { tool: "mt:get_identity", callId: "c1" } }),
      ev({ seq: 2, type: "tool.completed", payload: { tool: "mt:get_identity", callId: "c1", summary: "name: CHR", durationMs: 1200 } }),
    ]);
    expect(steps.length).toBe(1);
    expect(steps[0]).toMatchObject({ label: "Memeriksa koneksi & identitas", status: "completed", durationMs: 1200 });
    expect(steps[0]!.summary).toBe("name: CHR");
    expect(tx).toEqual([]);
  });

  test("dua tool paralel bernama sama tetap dibedakan via callId", () => {
    const { steps } = buildPipeline([
      ev({ seq: 1, type: "tool.started", payload: { tool: "mt:run_command", callId: "a" } }),
      ev({ seq: 2, type: "tool.started", payload: { tool: "mt:run_command", callId: "b" } }),
      ev({ seq: 3, type: "tool.failed", payload: { tool: "mt:run_command", callId: "b", code: "TOOL_FAILED" } }),
      ev({ seq: 4, type: "tool.completed", payload: { tool: "mt:run_command", callId: "a", summary: "ok" } }),
    ]);
    expect(steps.map((s) => s.status)).toEqual(["completed", "failed"]);
  });

  test("started tanpa pasangan menjadi unknown, bukan running selamanya", () => {
    const { steps } = buildPipeline([
      ev({ seq: 1, type: "tool.started", payload: { tool: "x", callId: "z" } }),
    ]);
    expect(steps[0]!.status).toBe("unknown");
  });

  test("transaction.updated menjadi tahap settlement dengan alasan", () => {
    const { tx } = buildPipeline([
      ev({ seq: 5, type: "transaction.updated", payload: { state: "rolled_back", actions: 0, reason: "empty" } }),
    ]);
    expect(tx).toEqual([
      expect.objectContaining({ state: "rolled_back", actions: 0, reason: "empty" }),
    ]);
  });

  test("terminal manual (tanpa runId) difilter dari pipeline AI", () => {
    const manual = ev({ runId: null, type: "terminal.completed", actor: "user", payload: {} });
    expect(isManualTerminalEvent(manual)).toBe(true);
    expect(isManualTerminalEvent(ev({ type: "tool.completed", payload: {} }))).toBe(false);
    expect(isCompactionEvent(ev({ type: "compaction.completed", payload: {} }))).toBe(true);
  });

  test("humanize + format durasi id-ID", () => {
    expect(humanizeTool("system:check_connection")).toBe("Memeriksa status koneksi");
    expect(formatDuration(2100)).toBe("2,1 dtk");
    expect(formatDuration(350)).toBe("350 mdtk");
    expect(formatDuration(null)).toBeNull();
  });
});
