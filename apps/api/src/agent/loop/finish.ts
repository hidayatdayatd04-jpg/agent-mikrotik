import type { ChatMessage, ChatToolCall } from "../chat-client";
import type { RunCounters } from "./context";

/** Hasil penanganan akhir giliran teks (tanpa tool call). */
export type StepFinishAction =
  | { action: "end" }
  | { action: "next" }
  | { action: "tools" };

/**
 * Giliran final kosong BUKAN jawaban selesai — bahkan bila giliran sebelumnya
 * berisi preamble + tool. Preamble bukan sintesis hasil; model wajib
 * menyimpulkan tool. Guard anti-berhenti prematur meneruskan run bila model
 * baru menulis rencana tanpa memanggil tool.
 */
export function handleStepFinish(
  counters: RunCounters,
  args: {
    stepText: string;
    stepToolCalls: ChatToolCall[];
    stepFinishReason: string | undefined;
    step: number;
    greetingOnly: boolean;
    providerToolsLength: number;
    chatHistory: ChatMessage[];
  },
): StepFinishAction {
  const { stepText, stepToolCalls, stepFinishReason } = args;
  // Temuan 4: validate finishReason — truncated output is not completed
  if (stepFinishReason === "length") {
    counters.finalStatus = "failed";
    counters.failCode = "TRUNCATED_RESPONSE";
    counters.failMessage = "Output provider terpotong karena batas token tercapai (finish_reason=length). Respons tidak lengkap.";
    return { action: "end" };
  }
  if (stepFinishReason === "content_filter") {
    counters.finalStatus = "failed";
    counters.failCode = "CONTENT_FILTERED";
    counters.failMessage = "Respons provider dihentikan oleh filter konten (finish_reason=content_filter).";
    return { action: "end" };
  }
  if (stepToolCalls.length === 0) {
    if (!stepText.trim()) {
      counters.finalStatus = "failed";
      counters.failCode = "EMPTY_RESPONSE";
      counters.failMessage =
        counters.toolCallsTotal > 0
          ? "Provider AI mengakhiri giliran tanpa menyimpulkan hasil tool yang sudah dibaca."
          : "Provider AI mengakhiri giliran tanpa memberikan teks jawaban atau pemanggilan tool.";
      return { action: "end" };
    }

    // Guard anti-berhenti prematur: bila model hanya mengeluarkan kalimat rencana/pengantar
    // pemeriksaan di step awal tanpa memanggil tool pada giliran ini dan belum ada
    // tool/kartu yang dijalankan, jangan matikan loop!
    const isPreambleWithoutTool =
      counters.toolCallsTotal === 0 &&
      args.step < 2 &&
      !args.greetingOnly &&
      args.providerToolsLength > 0 &&
      /(?:saya akan|akan saya|mari kita|sebentar saya|izinkan saya|saya periksa|saya cek|akan kami)\b/i.test(stepText) &&
      !/```(?:approval|ask)\b/.test(stepText);

    if (isPreambleWithoutTool) {
      args.chatHistory.push({ role: "assistant", content: stepText });
      args.chatHistory.push({
        role: "user",
        content:
          "[Sistem: Anda baru menulis rencana TANPA memanggil tool. Panggil SEKARANG tool yang relevan — " +
          "tool router bila soal router pengguna, atau tool pencarian web bila ini riset internet. Jangan hanya berbicara.]",
      });
      return { action: "next" };
    }

    args.chatHistory.push({ role: "assistant", content: stepText });
    return { action: "end" };
  }
  return { action: "tools" };
}
