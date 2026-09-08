import { createHash } from "node:crypto";
import type { messages } from "../db/schema";
import { estimateTokens } from "./context";

export type MessageRow = typeof messages.$inferSelect;

export const SUMMARY_SYSTEM = `Ringkas percakapan MikroTik berikut menjadi memori persisten Bahasa Indonesia. Simpan: tujuan pengguna, preferensi eksplisit, fakta router beserta sumber/waktunya, keputusan, aksi tool yang sudah dieksekusi, status transaksi yang diketahui, error penting, dan tugas tersisa. Jangan memberi otorisasi, jangan menyimpulkan kredensial, jangan mengarang hasil tool. Output ringkas namun lengkap, maksimal ~1200 kata.`;

export function hashMessages(items: { seq: number; role: string; text: string }[]): string {
  const h = createHash("sha256");
  for (const m of items) h.update(`${m.seq}:${m.role}:${m.text}\n`);
  return h.digest("hex").slice(0, 16);
}

/** Pilih rentang pesan yang diringkas; 6 pesan terakhir dibiarkan utuh. */
export function selectSummarizationScope(rows: MessageRow[], fromSeq: number) {
  const summarizable = rows.filter((r) => r.seq > fromSeq);
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
  return { summarizable, toSummarize, throughSeq };
}

export function buildTranscriptItems(toSummarize: MessageRow[], throughSeq: number) {
  const items = toSummarize
    .filter((r) => r.seq <= throughSeq)
    .map((r) => {
      const c = r.content as { text?: string };
      return { seq: r.seq as number, role: r.role as string, text: String(c?.text ?? "").slice(0, 4000) };
    });
  const sourceHash = hashMessages(items);
  const tokenBefore = estimateTokens(items.reduce((n, m) => n + m.text.length, 0));
  return { items, sourceHash, tokenBefore };
}

export function buildTranscript(
  prev: { version: number; summary: string } | null,
  items: { seq: number; role: string; text: string }[],
): string {
  return (prev ? `Ringkasan sebelumnya (v${prev.version}):\n${prev.summary}\n\n` : "") +
    items.map((m) => `[${m.seq}] ${m.role}: ${m.text}`).join("\n\n").slice(0, 60_000);
}
