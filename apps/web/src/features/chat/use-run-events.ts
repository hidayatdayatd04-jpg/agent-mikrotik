import { useEffect, useRef, useState } from "react";
import type { RunEventDTO } from "./chat-hooks";

/**
 * Live SSE subscription for one run (M9). Uses native EventSource
 * (same-origin cookie auth). Replays from seq 0; the server sends `done`
 * when the run reaches a terminal state, after which the connection closes.
 */
export function useRunEvents(runId: string | null, onDone?: () => void) {
  const [events, setEvents] = useState<RunEventDTO[]>([]);
  const [live, setLive] = useState(false);
  const [streamText, setStreamText] = useState("");
  const [toolActivity, setToolActivity] = useState<{ name: string; status: "running" | "done" | "failed" }[]>([]);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  useEffect(() => {
    if (!runId) {
      setEvents([]);
      setStreamText("");
      setToolActivity([]);
      setLive(false);
      return;
    }
    setEvents([]);
    setStreamText("");
    setToolActivity([]);
    setLive(true);

    const es = new EventSource(`/api/runs/${runId}/events`);
    es.onmessage = (e) => {
      if (!e.data) return;
      try {
        const parsed = JSON.parse(e.data) as { status?: string };
        if (parsed.status && ["completed", "failed", "cancelled"].includes(parsed.status)) {
          es.close();
          setLive(false);
          doneRef.current?.();
        }
      } catch {
        /* ignore non-JSON keepalives */
      }
    };
    for (const type of ["run.started", "message.delta", "tool.started", "tool.completed", "tool.failed", "run.completed", "run.failed", "run.cancelled"] as const) {
      es.addEventListener(type, (e: MessageEvent) => {
        try {
          const ev = JSON.parse(e.data) as RunEventDTO;
          setEvents((prev) => [...prev, ev]);
          if (ev.type === "message.delta") {
            setStreamText((prev) => prev + String((ev.payload as { text?: string }).text ?? ""));
          } else if (ev.type === "tool.started") {
            const name = String((ev.payload as { name?: string }).name ?? "tool");
            setToolActivity((prev) => [...prev, { name, status: "running" }]);
          } else if (ev.type === "tool.completed") {
            setToolActivity((prev) => {
              const next = [...prev];
              for (let i = next.length - 1; i >= 0; i--) {
                if (next[i]!.status === "running") {
                  next[i] = { ...next[i]!, status: "done" };
                  break;
                }
              }
              return next;
            });
          } else if (ev.type === "tool.failed") {
            setToolActivity((prev) => {
              const next = [...prev];
              for (let i = next.length - 1; i >= 0; i--) {
                if (next[i]!.status === "running") {
                  next[i] = { ...next[i]!, status: "failed" };
                  break;
                }
              }
              return next;
            });
          } else if (ev.type === "run.completed" || ev.type === "run.failed" || ev.type === "run.cancelled") {
            es.close();
            setLive(false);
            doneRef.current?.();
          }
        } catch {
          /* ignore malformed */
        }
      });
    }
    es.onerror = () => {
      // server closes after done; onerror fires on close in some browsers
      setLive(false);
    };
    return () => {
      es.close();
      setLive(false);
    };
  }, [runId]);

  return { events, streamText, toolActivity, live };
}
