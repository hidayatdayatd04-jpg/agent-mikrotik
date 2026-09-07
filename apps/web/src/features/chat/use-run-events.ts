import { useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
import type { RunEventDTO } from "./chat-hooks";

export interface LiveToolItem {
  id: string;
  name: string;
  status: "running" | "done" | "failed";
}

const TERMINAL = ["completed", "failed", "cancelled"];

/**
 * Live SSE subscription for one run (M9). Uses native EventSource
 * (same-origin). Deduplicates replay by sequence.
 *
 * Robustness rules (learned the hard way):
 * - `done` is only honored as a terminal signal; a bare transport close or
 *   error NEVER finishes the run — the server may still be working. Instead
 *   the stream reconnects with `?from=<lastSeq>` and the poller below covers
 *   the gap, so the UI can never idle forever on a live run.
 * - A lightweight poller confirms the terminal row state even if SSE is dead.
 */
export function useRunEvents(runId: string | null, onDone?: () => void) {
  const [events, setEvents] = useState<RunEventDTO[]>([]);
  const [live, setLive] = useState(false);
  const [streamText, setStreamText] = useState("");
  const [toolActivity, setToolActivity] = useState<LiveToolItem[]>([]);
  const [txStatus, setTxStatus] = useState<string | null>(null);
  const doneRef = useRef(onDone);
  const finishRef = useRef<() => void>(() => {});
  const lastSeqRef = useRef(0);
  doneRef.current = onDone;

  useEffect(() => {
    lastSeqRef.current = 0;
    if (!runId) {
      setEvents([]);
      setStreamText("");
      setToolActivity([]);
      setTxStatus(null);
      setLive(false);
      finishRef.current = () => {};
      return;
    }
    setEvents([]);
    setStreamText("");
    setToolActivity([]);
    setTxStatus(null);
    setLive(true);

    let cancelled = false;
    let confirmed = false;
    let es: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const teardown = () => {
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = null;
      try {
        es?.close();
      } catch {
        /* ignore */
      }
      es = null;
    };

    const confirmDone = () => {
      if (cancelled || confirmed) return;
      confirmed = true;
      teardown();
      setLive(false);
      doneRef.current?.();
    };
    finishRef.current = confirmDone;

    const handlePayload = (type: RunEventDTO["type"], data: string) => {
      if (confirmed) return;
      try {
        // The SSE event name carries the type; the JSON contains runId/seq/payload.
        const ev = { ...JSON.parse(data), type } as RunEventDTO;
        if (ev.runId !== runId || !Number.isInteger(ev.seq) || ev.seq <= lastSeqRef.current) return;
        lastSeqRef.current = ev.seq;
        setEvents((prev) => [...prev, ev]);
        if (ev.type === "message.delta") {
          setStreamText((prev) => prev + String((ev.payload as { text?: string }).text ?? ""));
        } else if (ev.type === "tool.started") {
          const p = ev.payload as { name?: string; callId?: string };
          const name = String(p.name ?? "tool");
          const id = String(p.callId ?? `${name}-${ev.seq}`);
          setToolActivity((prev) => (prev.some((t) => t.id === id) ? prev : [...prev, { id, name, status: "running" }]));
        } else if (ev.type === "transaction.updated") {
          const p = ev.payload as { state?: string; actions?: number };
          // Distinguish settling phase: commit/rollback in-flight vs terminal.
          const settling = ["preparing", "active", "verifying", "committing", "rolling_back"].includes(String(p.state ?? ""));
          setTxStatus(settling ? `Menyelesaikan transaksi · ${p.state} · aksi ${p.actions ?? 0}` : `Safe Mode ${p.state ?? "?"} · aksi ${p.actions ?? 0}`);
        } else if (ev.type === "tool.completed") {
          const p = ev.payload as { callId?: string };
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
          const p = ev.payload as { callId?: string };
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
        } else if (
          ev.type === "run.completed" ||
          ev.type === "run.failed" ||
          ev.type === "run.cancelled"
        ) {
          confirmDone();
        }
      } catch {
        /* ignore malformed */
      }
    };

    const connect = () => {
      if (cancelled || confirmed) return;
      try {
        es?.close();
      } catch {
        /* ignore */
      }
      const from = lastSeqRef.current;
      es = new EventSource(`/api/runs/${runId}/events${from > 0 ? `?from=${from}` : ""}`);
      es.onmessage = (e) => {
        if (!e.data || confirmed) return;
        try {
          const parsed = JSON.parse(e.data) as { status?: string };
          if (parsed.status && TERMINAL.includes(parsed.status)) {
            confirmDone();
          }
        } catch {
          /* ignore non-JSON keepalives */
        }
      };

      // The server only sends `done` for a terminal run (live terminal event
      // or an already-terminal row on (re)connect).
      es.addEventListener("done", () => {
        confirmDone();
      });

      for (const type of [
        "run.started",
        "message.delta",
        "tool.started",
        "tool.completed",
        "tool.failed",
        "transaction.updated",
        "run.completed",
        "run.failed",
        "run.cancelled",
      ] as const) {
        es.addEventListener(type, (e: MessageEvent) => handlePayload(type, (e as MessageEvent).data));
      }

      es.onerror = () => {
        if (cancelled || confirmed || !es) return;
        // Transport failure is NOT a terminal signal: EventSource may retry
        // on its own; when it gives up (CLOSED) we reconnect explicitly so a
        // live run keeps streaming instead of stranding the UI.
        if (es.readyState === 2) {
          try {
            es.close();
          } catch {
            /* ignore */
          }
          es = null;
          if (retryTimer) clearTimeout(retryTimer);
          retryTimer = setTimeout(connect, 2000);
        }
      };
    };

    connect();

    return () => {
      cancelled = true;
      teardown();
      finishRef.current = () => {};
    };
  }, [runId]);

  // Safety net: if SSE is dead, the UI must still settle when the server
  // already finished the run. Poll the run row; a terminal status finishes
  // locally and onDone refreshes messages — no manual refresh needed.
  useEffect(() => {
    if (!runId) return;
    let stopped = false;
    const poll = async () => {
      try {
        const res = await apiFetch<{ run: { id: string; status: string } }>(`/api/runs/${runId}`);
        if (!stopped && TERMINAL.includes(res.run.status)) {
          finishRef.current();
        }
      } catch {
        /* SSE remains the primary channel; retry next tick */
      }
    };
    const t = setInterval(poll, 3000);
    return () => {
      stopped = true;
      clearInterval(t);
    };
  }, [runId]);

  return { events, streamText, toolActivity, txStatus, live };
}
