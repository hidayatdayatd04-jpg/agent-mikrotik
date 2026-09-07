import { and, asc, desc, eq } from "drizzle-orm";
import { createHash } from "node:crypto";
import type { Database } from "../db";
import { compactionJobs, conversationSummaries, conversations, messages } from "../db/schema";
import { AppError } from "../lib/errors";
import type { Logger } from "../lib/logger";
import { recordActivity } from "../services/activity";
import { estimateTokens } from "./context";
import type { ChatClient } from "./chat-client";

export interface CompactionDeps {
  db: Database;
  logger: Logger;
  getProvider: (userId: string) => Promise<{ cfg: unknown; client: ChatClient; model: string; provider: string } | null>;
}

const SUMMARY_SYSTEM = `Ringkas percakapan MikroTik berikut menjadi memori persisten Bahasa Indonesia. Simpan: tujuan pengguna, preferensi eksplisit, fakta router beserta sumber/waktunya, keputusan, aksi tool yang sudah dieksekusi, status transaksi yang diketahui, error penting, dan tugas tersisa. Jangan memberi otorisasi, jangan menyimpulkan kredensial, jangan mengarang hasil tool. Output ringkas namun lengkap, maksimal ~1200 kata.`;

function hashMessages(items: { seq: number; role: string; text: string }[]): string {
  const h = createHash("sha256");
  for (const m of items) h.update(`${m.seq}:${m.role}:${m.text}\n`);
  return h.digest("hex").slice(0, 16);
}

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

async function runCompactionJob(
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
    const summarizable = rows.filter((r) => r.seq > fromSeq);
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
    const keepTail = 6;
    const toSummarize = summarizable.slice(0, Math.max(0, summarizable.length - keepTail));
    // Keep tool call/result pairs atomic: if cut lands inside a tool pair, adjust by id proximity.
    // Our messages table stores user/assistant turns; tool pairs live in tool_executions, so
    // atomicity here means: never split the last user+assistant pair.
    let throughSeq = toSummarize[toSummarize.length - 1]?.seq ?? fromSeq;
    if (toSummarize.length > 1) {
      const last = rows.find((r) => r.seq === throughSeq);
      const next = rows.find((r) => (r.seq as number) === (throughSeq as number) + 1);
      if (last?.role === "user" && next?.role === "assistant") {
        // Include the assistant reply to keep the pair together when available in toSummarize scope.
        const withNext = summarizable.find((r) => r.seq === next.seq);
        if (withNext) throughSeq = next.seq;
      }
    }

    const items = toSummarize
      .filter((r) => r.seq <= throughSeq)
      .map((r) => {
        const c = r.content as { text?: string };
        return { seq: r.seq as number, role: r.role as string, text: String(c?.text ?? "").slice(0, 4000) };
      });
    const sourceHash = hashMessages(items);
    const tokenBefore = estimateTokens(items.reduce((n, m) => n + m.text.length, 0));

    const resolved = await deps.getProvider(input.userId);
    if (!resolved) {
      throw new AppError("PROVIDER_NOT_CONFIGURED", "Provider AI belum dikonfigurasi; compact dibatalkan.", 400);
    }
    const transcript = (prev ? `Ringkasan sebelumnya (v${prev.version}):\n${prev.summary}\n\n` : "") +
      items.map((m) => `[${m.seq}] ${m.role}: ${m.text}`).join("\n\n").slice(0, 60_000);

    let summaryText = "";
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 90_000);
    try {
      for await (const ev of resolved.client.stream({
        messages: [
          { role: "system", content: SUMMARY_SYSTEM },
          { role: "user", content: transcript },
        ],
        tools: [],
        maxTokens: 1500,
        signal: controller.signal,
      })) {
        if (ev.type === "text" && ev.text) summaryText += ev.text;
        if (ev.type === "done") break;
      }
    } finally {
      clearTimeout(timeout);
    }
    summaryText = summaryText.trim();
    if (!summaryText) throw new Error("model mengembalikan ringkasan kosong");

    const nextVersion = (prev?.version ?? 0) + 1;
    const tokenAfter = estimateTokens(summaryText.length);
    await db.insert(conversationSummaries).values({
      conversationId: conv.id,
      version: nextVersion,
      throughSeq,
      sourceRevision: conv.revision ?? 1,
      sourceHash,
      summary: summaryText,
      model: resolved.model,
      provider: resolved.provider,
      usage: { tokenBefore, tokenAfter, basis: "estimasi" },
      tokenBefore,
      tokenAfter,
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
        model: resolved.model,
        throughSeq,
        tokenBefore,
        tokenAfter,
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

export async function latestSummary(db: Database, conversationId: string) {
  const rows = await db
    .select()
    .from(conversationSummaries)
    .where(eq(conversationSummaries.conversationId, conversationId))
    .orderBy(desc(conversationSummaries.version))
    .limit(1);
  return rows[0] ?? null;
}
