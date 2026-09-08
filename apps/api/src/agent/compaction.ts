import { and, desc, eq } from "drizzle-orm";
import type { Database } from "../db";
import { compactionJobs, conversationSummaries, conversations } from "../db/schema";
import { AppError } from "../lib/errors";
import type { CompactionDeps } from "./compaction-types";
import { runCompactionJob } from "./compaction-job";

export type { CompactionDeps } from "./compaction-types";

/** Single job per conversation+revision guard; CAS via revision. */
export async function startCompaction(
  deps: CompactionDeps,
  input: { userId: string; conversationId: string; reason: "manual" | "auto"; threshold?: number },
): Promise<{ jobId: string; status: string }> {
  const [conv] = await deps.db
    .select()
    .from(conversations)
    .where(and(eq(conversations.id, input.conversationId), eq(conversations.userId, input.userId)))
    .limit(1);
  if (!conv) throw new AppError("NOT_FOUND", "Percakapan tidak ditemukan.", 404);

  // One active job per conversation.
  const active = await deps.db
    .select()
    .from(compactionJobs)
    .where(and(eq(compactionJobs.conversationId, conv.id)))
    .orderBy(desc(compactionJobs.createdAt))
    .limit(5);
  const running = active.find((j) => j.status === "queued" || j.status === "running");
  if (running) return { jobId: running.id, status: running.status };

  const [job] = await deps.db
    .insert(compactionJobs)
    .values({
      conversationId: conv.id,
      sourceRevision: conv.revision ?? 1,
      status: "queued",
      reason: input.reason,
    })
    .returning();

  // Background execution.
  void runCompactionJob(deps, { userId: input.userId, conversationId: conv.id, jobId: job!.id }).catch((err) =>
    deps.logger.error("compaction crashed", { jobId: job!.id, message: err instanceof Error ? err.message : String(err) }),
  );
  return { jobId: job!.id, status: "queued" };
}

export async function latestSummary(db: Database, conversationId: string) {
  const rows = await db
    .select()
    .from(conversationSummaries)
    .where(eq(conversationSummaries.conversationId, conversationId))
    .orderBy(desc(conversationSummaries.version))
    .limit(1);
  return rows[0] ?? null;
}
