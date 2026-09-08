import { desc, eq } from "drizzle-orm";
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

  // "Lanjutkan pemeriksaan": muat ringkasan tool sukses dari run terakhir
  // agar run baru tidak mengulang pembacaan yang masih valid. Tidak pernah
  // memicu mutasi ulang — hanya hasil baca (risk=read, status completed).
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
      for (const r of lastRuns) {
        if (r.id === input.runId) continue;
        const rows = await db.select().from(toolTable).where(eq(toolTable.runId, r.id)).limit(20);
        for (const row of rows) {
          if (row.status === "completed" && row.risk === "read" && row.resultSummary) {
            priorNotes.push(`- ${row.toolName}: ${String(row.resultSummary).slice(0, 300)}`);
          }
          if (priorNotes.length >= 6) break;
        }
        if (priorNotes.length >= 6) break;
      }
      if (priorNotes.length > 0) {
        chatHistory.push({
          role: "user",
          content:
            "[Hasil pembacaan sebelumnya yang masih tersimpan — pakai langsung bila masih valid, jangan diulang. " +
            "Hanya baca ulang yang kedaluwarsa/diragukan, lalu kerjakan sisa yang belum selesai:]\n" +
            priorNotes.join("\n"),
        });
      }
    } catch {
      /* resume assist non-fatal */
    }
  }
  return { chatHistory };
}
