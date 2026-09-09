import { and, desc, eq, inArray } from "drizzle-orm";
import type { Database } from "../../db";
import { messages } from "../../db/schema";
import type { ChatMessage } from "../chat-client";
import type { StartRunInput } from "./types";

/**
 * conversation history: summary replaces old turns (no duplication).
 * Latest summary's throughSeq marks already-compacted history.
 */
export async function assembleHistory(
  db: Database,
  input: StartRunInput,
): Promise<{ chatHistory: ChatMessage[] }> {
  let throughSeq = 0;
  try {
    const { conversationSummaries } = await import("../../db/schema");
    const sums = await db
      .select()
      .from(conversationSummaries)
      .where(eq(conversationSummaries.conversationId, input.conversationId))
      .orderBy(desc(conversationSummaries.version))
      .limit(1);
    throughSeq = sums[0]?.throughSeq ?? 0;
  } catch {
    throughSeq = 0;
  }
  const history = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, input.conversationId))
    .orderBy(desc(messages.seq))
    .limit(60);
  const unsummarized = history.filter((m) => (m.seq as number) > throughSeq).slice(0, 24);
  const chatHistory: ChatMessage[] = [{ role: "system", content: input.systemInstruction }];
  for (const m of unsummarized.reverse()) {
    // Skip failed or cancelled assistant messages so previous provider errors (e.g. 429 rate limit
    // from a different provider or network issues) do not contaminate the context or cause the model
    // to hallucinate that it is also rate-limited!
    if (m.role === "assistant" && (m.status === "failed" || m.status === "cancelled")) {
      continue;
    }
    if (m.role === "user") {
      const content = m.content as { text?: string; context?: string };
      // Batas per-pesan agar lampiran/dump besar tidak meledakkan konteks
      // setiap turn (lampiran penuh tetap tersimpan di storage).
      const combined = String(content?.text ?? "") + (content?.context ?? "");
      chatHistory.push({ role: "user", content: combined.slice(0, 12_000) });
    } else if (m.role === "assistant") {
      const text = String((m.content as { text?: string })?.text ?? "").trim();
      if (text) {
        chatHistory.push({ role: "assistant", content: text });
      }
    }
  }

  // Ensure history does not end with an assistant turn (strictly required by Gemini API)
  while (chatHistory.length > 1 && chatHistory[chatHistory.length - 1]?.role === "assistant") {
    chatHistory.pop();
  }

  // "Lanjutkan pemeriksaan" / "continue": rangkum pekerjaan run terakhir
  // agar run baru meneruskan yang belum selesai — bukan mengulang dari nol.
  // Tidak pernah memicu mutasi ulang — hanya konteks baca + status.
  if (/lanjutkan|teruskan|continue/i.test(input.userText)) {
    try {
      const { toolExecutions: toolTable, agentRuns: runsTable } = await import("../../db/schema");
      const lastRuns = await db
        .select({ id: runsTable.id })
        .from(runsTable)
        .where(eq(runsTable.conversationId, input.conversationId))
        .orderBy(desc(runsTable.createdAt))
        .limit(3);
      const priorNotes: string[] = [];
      const failedNotes: string[] = [];
      for (const r of lastRuns) {
        if (r.id === input.runId) continue;
        const rows = await db.select().from(toolTable).where(eq(toolTable.runId, r.id)).limit(30);
        for (const row of rows) {
          if (row.status === "completed" && row.risk === "read" && row.resultSummary) {
            if (priorNotes.length < 8) {
              priorNotes.push(`- ${row.toolName}: ${String(row.resultSummary).slice(0, 400)}`);
            }
          } else if (row.status !== "completed" && failedNotes.length < 4) {
            failedNotes.push(
              `- ${row.toolName}: GAGAL (${String(row.errorCode ?? row.status)}) — putuskan apakah perlu dicoba lagi untuk melengkapi jawaban.`,
            );
          }
        }
        if (priorNotes.length >= 8 && failedNotes.length >= 4) break;
      }
      // Jawaban parsial run gagal terakhir: petunjuk progres, bukan fakta
      // terverifikasi. (Detail error tidak ikut — kini kartu terpisah;
      // sisa format lama disaring di sini.)
      let partialNote = "";
      try {
        const failed = await db
          .select()
          .from(messages)
          .where(
            and(
              eq(messages.conversationId, input.conversationId),
              eq(messages.role, "assistant"),
              inArray(messages.status, ["failed", "cancelled"]),
            ),
          )
          .orderBy(desc(messages.seq))
          .limit(1);
        const raw = String((failed[0]?.content as { text?: string } | null)?.text ?? "");
        const cleaned = (raw.split("\n\n---\nPemeriksaan belum selesai (")[0] ?? "").trim();
        if (cleaned) {
          partialNote =
            "[Jawaban parsial run sebelumnya yang TERPUTUS — jadikan petunjuk progres, bukan fakta terverifikasi:]\n" +
            cleaned.slice(0, 2000);
        }
      } catch {
        /* partial opsional */
      }
      const parts: string[] = [];
      if (priorNotes.length > 0) {
        parts.push(
          "[Hasil pembacaan sebelumnya yang masih tersimpan — pakai langsung bila masih valid, jangan diulang. Hanya baca ulang yang kedaluwarsa/diragukan:] \n" +
            priorNotes.join("\n"),
        );
      }
      if (failedNotes.length > 0) {
        parts.push("[Tool yang sempat GAGAL pada run sebelumnya:]\n" + failedNotes.join("\n"));
      }
      if (partialNote) parts.push(partialNote);
      if (parts.length > 0) {
        chatHistory.push({
          role: "user",
          content:
            "[MODE LANJUTAN: pengguna meminta meneruskan pekerjaan yang terputus karena error. " +
            "Aturan: 1) identifikasi dari konteks di atas bagian mana yang SUDAH selesai; " +
            "2) JANGAN ulangi pembacaan yang hasilnya sudah ada; " +
            "3) kerjakan HANYA sisa yang belum selesai atau belum dimulai; " +
            "4) akhiri dengan jawaban lengkap yang merangkum SEMUA temuan (lama + baru).]\n" +
            parts.join("\n\n"),
        });
      }
    } catch {
      /* resume assist non-fatal */
    }
  }
  return { chatHistory };
}
