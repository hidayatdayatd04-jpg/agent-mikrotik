import type { RunEvent } from "./loop";

/**
 * SSE hub (M7): runs publish events; browser subscribers receive a snapshot
 * first (for reconnect), then subsequent events. Slow clients are dropped
 * (bounded buffer) — the run itself is limited by the server deadline and
 * survives any browser disconnect.
 */
export interface RunSubscriber {
  id: string;
  send: (event: RunEvent) => void;
}

export class RunEventHub {
  private subscribers = new Map<string, Set<RunSubscriber>>(); // runId → subs
  private buffers = new Map<string, RunEvent[]>(); // runId → event log for reconnect

  subscribe(runId: string, sub: RunSubscriber, fromSeq = 0): RunEvent[] {
    let set = this.subscribers.get(runId);
    if (!set) {
      set = new Set();
      this.subscribers.set(runId, set);
    }
    set.add(sub);
    const log = this.buffers.get(runId) ?? [];
    return log.filter((e) => e.seq > fromSeq);
  }

  unsubscribe(runId: string, sub: RunSubscriber): void {
    this.subscribers.get(runId)?.delete(sub);
    if (this.subscribers.get(runId)?.size === 0) this.subscribers.delete(runId);
  }

  publish(runId: string, event: RunEvent): void {
    const log = this.buffers.get(runId) ?? [];
    log.push(event);
    // bound the replay buffer per run
    if (log.length > 2000) log.splice(0, log.length - 2000);
    this.buffers.set(runId, log);
    for (const sub of this.subscribers.get(runId) ?? []) {
      sub.send(event);
    }
    // completed runs: keep a short retention, then clear
    if (event.type === "run.completed" || event.type === "run.failed" || event.type === "run.cancelled") {
      setTimeout(() => {
        this.buffers.delete(runId);
        this.subscribers.delete(runId);
      }, 120_000).unref?.();
    }
  }

  replayUpTo(runId: string): RunEvent[] {
    return this.buffers.get(runId) ?? [];
  }

  subscriberCount(runId: string): number {
    return this.subscribers.get(runId)?.size ?? 0;
  }
}
