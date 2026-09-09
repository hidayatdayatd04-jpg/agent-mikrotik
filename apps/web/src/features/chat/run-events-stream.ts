import { useEffect } from "react";
import { STREAM_EVENT_TYPES, type RunEventsSink } from "./run-event-types";
import { attachTerminalListeners, createPayloadHandler } from "./run-events-reducer";

export function useRunEventStream(
  runId: string | null,
  sink: RunEventsSink,
  doneRef: { current: (() => void) | undefined },
  finishRef: { current: (immediate?: boolean) => void },
  lastSeqRef: { current: number },
) {
  const { setEvents, setStreamText, setToolActivity, setTxStatus, setQueueStatus, setLive } = sink;

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

    const handlePayload = createPayloadHandler({
      runId,
      lastSeqRef,
      sink,
      confirmDone,
      isConfirmed: () => confirmed,
      addStreamLength: (n: number) => {
        streamTextLength += n;
      },
    });

    const connect = () => {
      if (cancelled || confirmed) return;
      try {
        es?.close();
      } catch {
        /* ignore */
      }
      const from = lastSeqRef.current;
      es = new EventSource(`/api/runs/${runId}/events${from > 0 ? `?from=${from}` : ""}`);
      attachTerminalListeners(es, confirmDone, () => confirmed);

      for (const type of STREAM_EVENT_TYPES) {
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
}
