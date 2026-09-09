import { useEffect } from "react";
import { apiFetch } from "@/lib/api";
import { TERMINAL } from "./run-event-types";

export function useRunEventsPoll(runId: string | null, finishRef: { current: (immediate?: boolean) => void }) {
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
}
