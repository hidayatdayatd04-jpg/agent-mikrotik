import { useRef, useState } from "react";
import type { RunEventDTO } from "./chat-hooks";
import type { LiveRunError, LiveToolItem } from "./run-event-types";
import { useRunEventStream } from "./run-events-stream";
import { useRunEventsPoll } from "./run-events-poll";

export type { LiveRunError, LiveToolItem } from "./run-event-types";

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
  const [runError, setRunError] = useState<LiveRunError | null>(null);
  const doneRef = useRef(onDone);
  const finishRef = useRef<(immediate?: boolean) => void>(() => {});
  const lastSeqRef = useRef(0);
  doneRef.current = onDone;

  useRunEventStream(
    runId,
    { setEvents, setStreamText, setToolActivity, setTxStatus, setQueueStatus, setLive, setRunError },
    doneRef,
    finishRef,
    lastSeqRef,
  );
  useRunEventsPoll(runId, finishRef);

  return { events, streamText, toolActivity, txStatus, queueStatus, live, runError };
}
