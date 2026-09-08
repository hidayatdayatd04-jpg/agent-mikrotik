import { AppError } from "../../lib/errors";
import type { ChatMessage, ChatToolDefinition } from "./types";

/**
 * Bentuk wire OpenAI-compatible yang dikirim ke provider.
 * `content` SELALU string (tidak pernah null): endpoint OpenAI-compatible
 * Gemini (`/v1beta/openai/`) menolak `content: null` pada giliran
 * assistant+tool_calls dengan 400 "Request contains an invalid argument".
 * Itulah akar 400 pada alur satu-tool: request pertama (tanpa tool turn)
 * lolos, request kedua (assistant null + tool result) ditolak.
 */
export interface ProviderWireMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string }; extra_content?: unknown }[];
  tool_call_id?: string;
}

/**
 * Normalisasi pesan internal → payload provider yang valid lintas
 * Gemini native-via-OpenAI-compat, OpenAI-compatible, dan OpenRouter:
 *  - system non-pertama → user berprefix (Gemini hanya menerima satu
 *    system instruction di awal; system di tengah percakapan → 400).
 *  - assistant+tool_calls dengan content null/kosong → "" (Gemini menolak null).
 *  - extra_content hanya diteruskan ke Gemini (field non-standar; provider
 *    ketat lain menolak field tak dikenal dengan 400).
 *  - tool tanpa tool_call_id / content non-string diperbaiki atau ditolak
 *    sebelum request dikirim (hemat kuota: tanpa.compose doomed request).
 *
 * Melempar AppError VALIDATION_FAILED bila pasangan assistant(tool_calls)
 * ↔ tool result rusak — tanpa menyentuh kuota provider.
 */
export function buildProviderMessages(
  messages: ChatMessage[],
  providerKind: string,
): ProviderWireMessage[] {
  const declared = new Map<string, number>(); // tool_call id → index pesan assistant
  const answered = new Map<string, number>(); // tool_call id → index pesan tool
  const out: ProviderWireMessage[] = [];
  let seenFirstSystem = false;

  messages.forEach((m, idx) => {
    if (m.role === "system" && seenFirstSystem) {
      out.push({ role: "user", content: `[Catatan sistem] ${m.content ?? ""}` });
      return;
    }
    if (m.role === "system") {
      seenFirstSystem = true;
      out.push({ role: "system", content: m.content ?? "" });
      return;
    }
    if (m.role === "tool") {
      const id = (m.toolCallId ?? "").trim();
      if (!id) {
        throw new AppError("VALIDATION_FAILED", `Payload tool rusak (pesan ${idx}): tool_call_id kosong — request dibatalkan sebelum menghabiskan kuota.`, 422);
      }
      if (answered.has(id)) {
        throw new AppError("VALIDATION_FAILED", `Payload tool rusak: tool_call_id "${id}" dijawab dua kali — request dibatalkan sebelum menghabiskan kuota.`, 422);
      }
      answered.set(id, idx);
      out.push({ role: "tool", content: m.content ?? "", tool_call_id: id });
      return;
    }
    if (m.role === "assistant" && m.toolCalls?.length) {
      const calls: NonNullable<ProviderWireMessage["tool_calls"]> = m.toolCalls.map((tc) => {
        if (!tc.id || !tc.name) {
          throw new AppError("VALIDATION_FAILED", `Payload tool rusak (pesan ${idx}): tool call tanpa id/nama — request dibatalkan sebelum menghabiskan kuota.`, 422);
        }
        if (declared.has(tc.id)) {
          throw new AppError("VALIDATION_FAILED", `Payload tool rusak: tool_call_id "${tc.id}" dideklarasikan dua kali — request dibatalkan sebelum menghabiskan kuota.`, 422);
        }
        declared.set(tc.id, idx);
        return {
          id: tc.id,
          type: "function" as const,
          // Sanitasi argumen SEBELUM dikirim: model kadang memancarkan JSON
          // tak lengkap (stream terpotong). Argumen parsial/non-objek yang
          // digaungkan apa adanya memicu 400 "invalid argument" pada Gemini
          // di request lanjutan — bukti live: 400 selalu menyusul
          // VALIDATION_FAILED. Ganti dengan objek kosong yang valid; hasil
          // tool (termasuk pesan validasi) tetap terkirim sebagai feedback.
          function: { name: tc.name, arguments: sanitizeToolArguments(tc.argumentsJson) },
          // `extra_content` (mis. thought signature Gemini thinking) hanya
          // diteruskan ke Gemini; provider ketat lain menolak field tak dikenal (400).
          ...(providerKind === "gemini" && tc.extraContent !== undefined ? { extra_content: tc.extraContent } : {}),
        };
      });
      out.push({ role: "assistant", content: m.content ?? "", tool_calls: calls });
      return;
    }
    out.push({ role: m.role as "user" | "assistant", content: m.content ?? "" });
  });

  // Setiap tool_calls wajib dijawab tepat satu tool message, dan sebaliknya.
  for (const [id] of declared) {
    if (!answered.has(id)) {
      throw new AppError("VALIDATION_FAILED", `Payload tool rusak: tool_call_id "${id}" tanpa hasil tool — request dibatalkan sebelum menghabiskan kuota.`, 422);
    }
  }
  for (const [id] of answered) {
    if (!declared.has(id)) {
      throw new AppError("VALIDATION_FAILED", `Payload tool rusak: hasil tool "${id}" tanpa pemanggil — request dibatalkan sebelum menghabiskan kuota.`, 422);
    }
  }
  return out;
}

/** Argumen tool harus berupa objek JSON valid; selain itu kirim "{}" agar provider tidak 400. */
export function sanitizeToolArguments(raw: string | null | undefined): string {
  const s = (raw ?? "").trim();
  if (!s) return "{}";
  try {
    const parsed: unknown = JSON.parse(s);
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) return s;
    return "{}";
  } catch {
    return "{}";
  }
}

/** Pastikan definisi tool berupa function-object valid; default schema kosong yang aman. */
export function buildProviderTools(tools: ChatToolDefinition[]): ChatToolDefinition[] {
  return tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.function.name,
      description: t.function.description,
      parameters:
        t.function.parameters && typeof t.function.parameters === "object"
          ? (t.function.parameters as Record<string, unknown>)
          : { type: "object", properties: {} },
    },
  }));
}
