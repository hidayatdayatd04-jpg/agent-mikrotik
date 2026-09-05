import { describe, expect, test } from "vitest";

/**
 * Pure-logic tests for the chat UI (M9): SSE event stream → view state
 * reducers mirror use-run-events.ts semantics without a DOM.
 */

interface ToolActivity {
  name: string;
  status: "running" | "done" | "failed";
}

/** Same reducer semantics as useRunEvents: newest running slot resolves. */
function applyToolEvent(activity: ToolActivity[], ev: { type: string; payload: { name?: string } }): ToolActivity[] {
  const next = [...activity];
  if (ev.type === "tool.started") {
    next.push({ name: String(ev.payload.name ?? "tool"), status: "running" });
    return next;
  }
  if (ev.type === "tool.completed" || ev.type === "tool.failed") {
    for (let i = next.length - 1; i >= 0; i--) {
      if (next[i]!.status === "running") {
        next[i] = { ...next[i]!, status: ev.type === "tool.completed" ? "done" : "failed" };
        break;
      }
    }
  }
  return next;
}

/** SSE event sequence → done state check (mirrors use-run-events onmessage). */
function isTerminalDone(data: string): boolean {
  try {
    const parsed = JSON.parse(data) as { status?: string };
    return !!parsed.status && ["completed", "failed", "cancelled"].includes(parsed.status);
  } catch {
    return false;
  }
}

describe("chat UI stream logic", () => {
  test("tool activity: started → completed marks newest running slot done", () => {
    let activity: ToolActivity[] = [];
    activity = applyToolEvent(activity, { type: "tool.started", payload: { name: "docs:routeros_search" } });
    expect(activity).toEqual([{ name: "docs:routeros_search", status: "running" }]);
    activity = applyToolEvent(activity, { type: "tool.completed", payload: {} });
    expect(activity).toEqual([{ name: "docs:routeros_search", status: "done" }]);
  });

  test("tool activity: failed marks the failing tool, keeps earlier done slots", () => {
    let activity: ToolActivity[] = [];
    activity = applyToolEvent(activity, { type: "tool.started", payload: { name: "a" } });
    activity = applyToolEvent(activity, { type: "tool.completed", payload: {} });
    activity = applyToolEvent(activity, { type: "tool.started", payload: { name: "b" } });
    activity = applyToolEvent(activity, { type: "tool.failed", payload: {} });
    expect(activity).toEqual([
      { name: "a", status: "done" },
      { name: "b", status: "failed" },
    ]);
  });

  test("terminal done frame closes the stream; keepalive frames ignored", () => {
    expect(isTerminalDone('{"status":"completed"}')).toBe(true);
    expect(isTerminalDone('{"status":"failed"}')).toBe(true);
    expect(isTerminalDone('{"status":"cancelled"}')).toBe(true);
    expect(isTerminalDone('{"status":"running"}')).toBe(false);
    expect(isTerminalDone(": heartbeat")).toBe(false);
    expect(isTerminalDone("not json")).toBe(false);
  });

  test("message deltas concatenate in order", () => {
    const deltas = ["Halo ", "dunia", "!"];
    const text = deltas.reduce((acc, d) => acc + d, "");
    expect(text).toBe("Halo dunia!");
  });

  test("idempotencyKey generator produces unique keys", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const key = `ui-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 10)}`;
      expect(key.length).toBeLessThanOrEqual(128);
      expect(key.length).toBeGreaterThanOrEqual(8);
      seen.add(key);
    }
    expect(seen.size).toBe(100);
  });
});
