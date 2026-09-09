import type { RunEventDTO } from "./chat-hooks";
import { TERMINAL, type RunEventsSink } from "./run-event-types";

export interface PayloadHandlerCtx {
  runId: string;
  lastSeqRef: { current: number };
  sink: RunEventsSink;
  confirmDone: (immediate?: boolean) => void;
  isConfirmed: () => boolean;
  addStreamLength: (n: number) => void;
}

export function attachTerminalListeners(es: EventSource, confirmDone: (immediate?: boolean) => void, isConfirmed: () => boolean) {
  es.onmessage = (e) => {
    if (!e.data || isConfirmed()) return;
    try {
      const parsed = JSON.parse(e.data) as { status?: string };
      if (parsed.status && TERMINAL.includes(parsed.status)) {
        confirmDone(parsed.status === "cancelled");
      }
    } catch {
      /* ignore non-JSON keepalives */
    }
  };

  // The server only sends `done` for a terminal run (live terminal event
  // or an already-terminal row on (re)connect).
  es.addEventListener("done", () => {
    confirmDone(false);
  });
}

export function createPayloadHandler(ctx: PayloadHandlerCtx) {
  const { runId, lastSeqRef, sink, addStreamLength } = ctx;
  const { setEvents, setStreamText, setToolActivity, setTxStatus, setQueueStatus } = sink;

  return function handlePayload(type: RunEventDTO["type"], data: string) {
    if (ctx.isConfirmed()) return;
    try {
      // The SSE event name carries the type; the JSON contains runId/seq/payload.
      const ev = { ...JSON.parse(data), type } as RunEventDTO;
      if (ev.runId !== runId || !Number.isInteger(ev.seq) || ev.seq <= lastSeqRef.current) return;
      lastSeqRef.current = ev.seq;
      setEvents((prev) => [...prev, ev]);
      if (ev.type === "message.delta") {
        setQueueStatus(null);
        const chunk = String((ev.payload as { text?: string }).text ?? "");
        addStreamLength(chunk.length);
        setStreamText((prev) => prev + chunk);
      } else if (ev.type === "provider.waiting") {
        const p = ev.payload as { waitedMs?: number };
        const secs = Math.max(1, Math.round(Number(p.waitedMs ?? 0) / 1000));
        setQueueStatus(`Menunggu giliran provider · antre ${secs} dtk`);
      } else if (ev.type === "tool.started") {
        setQueueStatus(null);
        const p = ev.payload as { name?: string; callId?: string };
        const name = String(p.name ?? "tool");
        if (name.startsWith("web:")) return; // Deep Research — kartu sendiri via liveEvents
        const id = String(p.callId ?? `${name}-${ev.seq}`);
        setToolActivity((prev) => (prev.some((t) => t.id === id) ? prev : [...prev, { id, name, status: "running" }]));
      } else if (ev.type === "transaction.updated") {
        const p = ev.payload as { state?: string; actions?: number };
        // Distinguish settling phase: commit/rollback in-flight vs terminal.
        const settling = ["preparing", "active", "verifying", "committing", "rolling_back"].includes(String(p.state ?? ""));
        setTxStatus(settling ? `Menyelesaikan transaksi · ${p.state} · aksi ${p.actions ?? 0}` : `Safe Mode ${p.state ?? "?"} · aksi ${p.actions ?? 0}`);
      } else if (ev.type === "tool.completed") {
        const p = ev.payload as { callId?: string; name?: string };
        if (String(p.name ?? "").startsWith("web:")) return; // Deep Research
        const id = p.callId ? String(p.callId) : null;
        setToolActivity((prev) => {
          const next = [...prev];
          if (id) {
            const idx = next.findIndex((t) => t.id === id);
            if (idx >= 0) {
              next[idx] = { ...next[idx]!, status: "done" };
              return next;
            }
          }
          for (let i = next.length - 1; i >= 0; i--) {
            if (next[i]!.status === "running") {
              next[i] = { ...next[i]!, status: "done" };
              break;
            }
          }
          return next;
        });
      } else if (ev.type === "tool.failed") {
        const p = ev.payload as { callId?: string; name?: string };
        if (String(p.name ?? "").startsWith("web:")) return; // Deep Research
        const id = p.callId ? String(p.callId) : null;
        setToolActivity((prev) => {
          const next = [...prev];
          if (id) {
            const idx = next.findIndex((t) => t.id === id);
            if (idx >= 0) {
              next[idx] = { ...next[idx]!, status: "failed" };
              return next;
            }
          }
          for (let i = next.length - 1; i >= 0; i--) {
            if (next[i]!.status === "running") {
              next[i] = { ...next[i]!, status: "failed" };
              break;
            }
          }
          return next;
        });
      } else if (ev.type === "run.cancelled") {
        ctx.confirmDone(true);
      } else if (ev.type === "run.completed" || ev.type === "run.failed") {
        ctx.confirmDone(false);
      }
    } catch {
      /* ignore malformed */
    }
  };
}
