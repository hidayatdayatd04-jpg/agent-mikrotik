import { eq } from "drizzle-orm";
import type { Database } from "../../db";
import { agentRuns, messages } from "../../db/schema";
import { redactObject, redactText } from "../../lib/redaction";
import type { EmitFn, RunCounters } from "./context";
import { usageRecordOf } from "./context";

export interface FinalizeEnv {
  db: Database;
}

export interface FinalizeInput {
  runId: string;
  conversationId: string;
  modelLabel: string;
}

/** Finalisasi run: penutup kegagalan, persist pesan assistant, status + event terminal. */
export async function finalizeRun(
  env: FinalizeEnv,
  input: FinalizeInput,
  c: RunCounters,
  emitSeq: EmitFn,
): Promise<void> {
  const status = c.finalStatus;
  if (status !== "completed" || !c.assistantText.trim()) {
    if (status === "completed" && !c.assistantText.trim()) {
      c.finalStatus = "failed";
      c.failCode = "EMPTY_RESPONSE";
      c.failMessage = "Provider AI mengakhiri giliran tanpa memberikan teks jawaban atau pemanggilan tool.";
    }
    // Kegagalan TIDAK disisipkan ke teks chat: detail error (kode, pesan
    // provider, progres tool) disampaikan sebagai kartu error terstruktur
    // via event run.failed + outcome pesan — bukan bubble chat. Teks parsial
    // yang sudah ter-stream dipertahankan apa adanya.
    if (c.finalStatus === "cancelled" && !c.assistantText.trim()) {
      c.assistantText = "(Run dibatalkan pengguna)";
    }
  }

  const all = await env.db
    .select({ seq: messages.seq })
    .from(messages)
    .where(eq(messages.conversationId, input.conversationId));
  const maxSeq = all.reduce((m, r) => Math.max(m, r.seq), 0);
  const toolSucceeded = c.toolOutcomes.filter((t) => t.ok).length;
  const toolFailed = c.toolOutcomes.filter((t) => !t.ok).length;
  const outcome =
    c.finalStatus === "completed"
      ? { status: "completed" as const, toolSucceeded, toolFailed }
      : {
          status: c.finalStatus as "failed" | "cancelled",
          code: c.failCode ?? "RUN_FAILED",
          reason: c.failMessage ?? "Run gagal.",
          toolSucceeded,
          toolFailed,
          // Daftar fq tool yang sudah berhasil — dipakai tombol
          // "Lanjutkan pemeriksaan" agar tidak mengulang pembacaan valid.
          succeededTools: c.toolOutcomes.filter((t) => t.ok).map((t) => t.fq),
          // True bila ada jawaban parsial yang ikut tersimpan di teks.
          hasPartial: c.assistantText.trim().length > 0,
        };
  await env.db.insert(messages).values({
    conversationId: input.conversationId,
    role: "assistant",
    content: { text: redactText(c.assistantText), runId: input.runId, timeline: redactObject(c.timeline), outcome },
    status: c.finalStatus === "completed" ? "complete" : c.finalStatus,
    seq: maxSeq + 1,
  });

  await env.db
    .update(agentRuns)
    .set({
      status: c.finalStatus,
      endedAt: new Date(),
      usage: c.finalStatus === "failed" ? { ...usageRecordOf(c, input.modelLabel), error: c.failCode ?? undefined } : usageRecordOf(c, input.modelLabel),
    })
    .where(eq(agentRuns.id, input.runId));

  if (c.finalStatus === "completed") {
    await emitSeq({ type: "run.completed", payload: { usage: usageRecordOf(c, input.modelLabel) } });
  } else if (c.finalStatus === "cancelled") {
    await emitSeq({ type: "run.cancelled", payload: { reason: c.failMessage ?? "dibatalkan pengguna" } });
  } else {
    // Payload terstruktur untuk kartu error di UI (bukan teks chat):
    // kode, pesan provider, progres tool, dan penanda jawaban parsial.
    await emitSeq({
      type: "run.failed",
      payload: {
        code: c.failCode ?? "RUN_FAILED",
        message: c.failMessage ?? "Run gagal.",
        toolSucceeded,
        toolFailed,
        succeededTools: c.toolOutcomes.filter((t) => t.ok).map((t) => t.fq),
        hasPartial: c.assistantText.trim().length > 0,
      },
    });
  }
}
