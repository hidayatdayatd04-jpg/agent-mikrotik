import { asc, desc, eq } from "drizzle-orm";
import { compactionJobs, conversationSummaries, conversations, messages } from "../db/schema";
import { AppError } from "../lib/errors";
import { recordActivity } from "../services/activity";
import type { CompactionDeps } from "./compaction-types";
import { selectSummarizationScope } from "./compaction-prompt";
import { summarizeWithProvider } from "./compaction-summarize";

export async function runCompactionJob(
  deps: CompactionDeps,
  input: { userId: string; conversationId: string; jobId: string },
): Promise<void> {
  const { db } = deps;
  await db.update(compactionJobs).set({ status: "running", updatedAt: new Date() }).where(eq(compactionJobs.id, input.jobId));
  const jobId = input.jobId;
  try {
    const [conv] = await db.select().from(conversations).where(eq(conversations.id, input.conversationId)).limit(1);
    if (!conv) throw new Error("percakapan hilang");

    const prevSummaries = await db
      .select()
      .from(conversationSummaries)
      .where(eq(conversationSummaries.conversationId, conv.id))
      .orderBy(desc(conversationSummaries.version))
      .limit(1);
    const prev = prevSummaries[0] ?? null;
    const fromSeq = prev?.throughSeq ?? 0;

    const rows = await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conv.id))
      .orderBy(asc(messages.seq))
      .limit(2000);
    // Keep recent turns whole: exclude last 6 messages from summarization input.
    const { summarizable, toSummarize, throughSeq } = selectSummarizationScope(rows, fromSeq);
    if (summarizable.length <= 8) {
      await db.update(compactionJobs).set({ status: "completed", updatedAt: new Date() }).where(eq(compactionJobs.id, jobId));
      await recordActivity(db, {
        conversationId: conv.id,
        type: "compaction.completed",
        actor: "system",
        activityId: `compact-${jobId}`,
        payload: { reason: "nothing-to-compact", throughSeq: fromSeq, note: "Riwayat masih pendek; tidak ada ringkasan baru." },
      });
      return;
    }

    const s = await summarizeWithProvider(deps, { userId: input.userId, prev, toSummarize, throughSeq });
    const nextVersion = (prev?.version ?? 0) + 1;
    await db.insert(conversationSummaries).values({
      conversationId: conv.id,
      version: nextVersion,
      throughSeq,
      sourceRevision: conv.revision ?? 1,
      sourceHash: s.sourceHash,
      summary: s.summaryText,
      model: s.model,
      provider: s.provider,
      usage: { tokenBefore: s.tokenBefore, tokenAfter: s.tokenAfter, basis: "estimasi" },
      tokenBefore: s.tokenBefore,
      tokenAfter: s.tokenAfter,
    });
    await db
      .update(compactionJobs)
      .set({ status: "completed", summaryVersion: nextVersion, updatedAt: new Date() })
      .where(eq(compactionJobs.id, jobId));
    await recordActivity(db, {
      conversationId: conv.id,
      type: "compaction.completed",
      actor: "system",
      activityId: `compact-${jobId}`,
      payload: {
        reason: "manual",
        model: s.model,
        throughSeq,
        tokenBefore: s.tokenBefore,
        tokenAfter: s.tokenAfter,
        version: nextVersion,
        estimated: true,
        note: "Konteks diringkas; percakapan dilanjutkan",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const code = err instanceof AppError ? err.code : "INTERNAL_ERROR";
    await deps.db
      .update(compactionJobs)
      .set({ status: "failed", error: `${code}: ${message}`.slice(0, 1000), updatedAt: new Date() })
      .where(eq(compactionJobs.id, jobId))
      .catch(() => {});
    await recordActivity(deps.db, {
      conversationId: input.conversationId,
      type: "compaction.failed",
      actor: "system",
      activityId: `compact-${jobId}`,
      payload: { error: message.slice(0, 500), code, retryable: true },
    }).catch(() => {});
  }
}
