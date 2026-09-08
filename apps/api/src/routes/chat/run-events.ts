import type { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { AppError } from "../../lib/errors";
import type { Env } from "../../types";
import type { RunEvent } from "../../agent/loop";
import { agentRuns } from "../../db/schema";
import { requireWorkspace } from "./helpers";
import type { ChatCtx } from "./types";

/** SSE live run events (snapshot dulu untuk reconnect, lalu live). */
export function registerRunEventRoutes(routes: Hono<Env>, ctx: ChatCtx) {
  const { deps, backgroundRuns } = ctx;

  routes.get("/api/runs/:id/events", async (c) => {
    const workspace = requireWorkspace(c);
    const [row] = await deps.db
      .select()
      .from(agentRuns)
      .where(and(eq(agentRuns.id, c.req.param("id")), eq(agentRuns.userId, workspace.userId)))
      .limit(1);
    if (!row) throw new AppError("NOT_FOUND", "Run tidak ditemukan.", 404);
    const runId = row.id;
    const fromSeq = Number(new URL(c.req.url).searchParams.get("from") ?? 0);

    // snapshot first (for reconnect), then live events
    const snapshot = deps.hub.replayUpTo(runId).filter((e) => e.seq > fromSeq);
    return new Response(
      new ReadableStream({
        start(controller) {
          const enc = new TextEncoder();
          let closed = false;
          const write = (data: string) => {
            if (!closed) controller.enqueue(enc.encode(data));
          };
          for (const ev of snapshot) {
            write(`id: ${ev.seq}\nevent: ${ev.type}\ndata: ${JSON.stringify({ runId: ev.runId, seq: ev.seq, payload: ev.payload })}\n\n`);
          }
          if (!backgroundRuns.has(runId) && (row.status === "completed" || row.status === "failed" || row.status === "cancelled")) {
            // terminal state already reached; end the stream
            write(`event: done\ndata: ${JSON.stringify({ status: row.status })}\n\n`);
            closed = true;
            controller.close();
            return;
          }
          const sub = {
            id: `sub-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            send: (event: RunEvent) => {
              if (event.seq <= fromSeq) return;
              write(`id: ${event.seq}\nevent: ${event.type}\ndata: ${JSON.stringify({ runId: event.runId, seq: event.seq, payload: event.payload })}\n\n`);
              if (event.type === "run.completed" || event.type === "run.failed" || event.type === "run.cancelled") {
                write(`event: done\ndata: {}\n\n`);
                closed = true;
                controller.close();
              }
            },
          };
          deps.hub.subscribe(runId, sub, fromSeq);
          const heartbeat = setInterval(() => write(`: heartbeat\n\n`), 15_000);
          c.req.raw.signal.addEventListener("abort", () => {
            clearInterval(heartbeat);
            deps.hub.unsubscribe(runId, sub);
            closed = true;
            try {
              controller.close();
            } catch {
              /* already closed */
            }
          });
        },
      }),
      {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        },
      },
    );
  });
}
