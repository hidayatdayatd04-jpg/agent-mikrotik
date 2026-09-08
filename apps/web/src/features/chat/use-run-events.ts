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
  const [queueStatus, setQueueStatus] = useState<string | null>(null);
  const doneRef = useRef(onDone);
  const finishRef = useRef<(immediate?: boolean) => void>(() => {});
  const lastSeqRef = useRef(0);
  doneRef.current = onDone;

  useEffect(() => {
    lastSeqRef.current = 0;
    if (!runId) {
      setEvents([]);
      setStreamText("");
      setToolActivity([]);
      setTxStatus(null);
      setQueueStatus(null);
      setLive(false);
      finishRef.current = () => {};
      return;
    }
    setEvents([]);
    setStreamText("");
    setToolActivity([]);
    setTxStatus(null);
    setQueueStatus(null);
    setLive(true);

    let cancelled = false;
    let confirmed = false;
    let es: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let completeTimer: ReturnType<typeof setTimeout> | null = null;
    let streamTextLength = 0;

    const teardown = () => {
      if (retryTimer) clearTimeout(retryTimer);
      if (completeTimer) clearTimeout(completeTimer);
      retryTimer = null;
      completeTimer = null;
      try {
        es?.close();
      } catch {
        /* ignore */
      }
      es = null;
    };

    const confirmDone = (immediate = false) => {
      if (cancelled || confirmed) return;
      try {
        es?.close();
      } catch {}
      es = null;

      if (immediate || streamTextLength === 0) {
        if (completeTimer) clearTimeout(completeTimer);
        confirmed = true;
        teardown();
        setLive(false);
        doneRef.current?.();
        return;
      }

      // Allow smooth typewriter to complete its visual typing cadence (~22ms per char)
      const typingWaitMs = Math.min(2200, Math.max(350, streamTextLength * 22));
      if (completeTimer) clearTimeout(completeTimer);
      completeTimer = setTimeout(() => {
        if (cancelled || confirmed) return;
        confirmed = true;
        teardown();
        setLive(false);
        doneRef.current?.();
      }, typingWaitMs);
    };
    finishRef.current = (immediate?: boolean) => confirmDone(immediate);

    const handlePayload = (type: RunEventDTO["type"], data: string) => {
      if (confirmed) return;
      try {
        // The SSE event name carries the type; the JSON contains runId/seq/payload.
        const ev = { ...JSON.parse(data), type } as RunEventDTO;
        if (ev.runId !== runId || !Number.isInteger(ev.seq) || ev.seq <= lastSeqRef.current) return;
        lastSeqRef.current = ev.seq;
        setEvents((prev) => [...prev, ev]);
        if (ev.type === "message.delta") {
          setQueueStatus(null);
          const chunk = String((ev.payload as { text?: string }).text ?? "");
          streamTextLength += chunk.length;
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
          confirmDone(true);
        } else if (
          ev.type === "run.completed" ||
          ev.type === "run.failed"
        ) {
          confirmDone(false);
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

      for (const type of [
        "run.started",
        "message.delta",
        "tool.started",
        "tool.completed",
        "tool.failed",
        "transaction.updated",
        "provider.waiting",
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
          finishRef.current(res.run.status === "cancelled");
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

  return { events, streamText, toolActivity, txStatus, queueStatus, live };
}
