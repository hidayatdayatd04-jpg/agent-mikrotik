/**
 * Reasoning-effort support shared by backend + web UI.
 *
 * Satu sumber kebenaran untuk:
 *  - tipe effort yang dikirim ke provider (`reasoning_effort`),
 *  - deteksi heuristik apakah sebuah model id mendukung reasoning.
 *
 * Deteksi bersifat heuristik berbasis nama model karena daftar model
 * datang dinamis dari provider (Gemini / OpenRouter / custom) tanpa
 * metadata kapabilitas yang seragam. Heuristik ini sengaja konservatif:
 * hanya model yang namanya jelas-jelas keluarga reasoning yang lolos,
 * sehingga picker reasoning di composer tidak muncul untuk model biasa.
 */

export const REASONING_EFFORTS = ["low", "medium", "high"] as const;
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

/** Nilai yang boleh dikirim dari UI/API (termasuk "off" = tanpa reasoning). */
export const RUN_REASONING_VALUES = ["off", ...REASONING_EFFORTS] as const;
export type RunReasoningValue = (typeof RUN_REASONING_VALUES)[number];

/**
 * Pola nama model yang mendukung reasoning / thinking.
 * Dicocokkan case-insensitive terhadap model id.
 */
const REASONING_PATTERNS: RegExp[] = [
  // OpenAI reasoning family: o1, o3, o4-mini, gpt-5, gpt-oss
  /(^|[^a-z0-9])o1([^a-z0-9]|$)/,
  /(^|[^a-z0-9])o3([^a-z0-9]|$)/,
  /(^|[^a-z0-9])o4-mini([^a-z0-9]|$)/,
  /gpt-5/,
  /gpt-oss/,
  // DeepSeek reasoner
  /deepseek[-_/]?r1/,
  /deepseek[-_/]?reasoner/,
  /(^|[^a-z0-9])r1([^a-z0-9]|$)/,
  // Qwen reasoning: QwQ, Qwen3 thinking
  /qwq/,
  /qwen3/,
  // Gemini thinking: 2.5 series, 2.0-flash-thinking, 3.x
  /gemini[-_]?2\.5/,
  /gemini[-_]?3/,
  /flash-thinking/,
  // Anthropic extended thinking: 3.7, 4.x, opus/sonnet-4
  /claude[-_]?3[-_]?7/,
  /claude[-_]?4/,
  /opus[-_]?4/,
  /sonnet[-_]?4/,
  // xAI
  /grok[-_]?4/,
  // Fallback generik: nama mengandung kata reasoning/thinking
  /reasoning/,
  /reasoner/,
  /thinking/,
  /magistral/,
  /k2-thinking/,
  /nemotron.*think/,
  /glm[-_]?4\.5/,
];

/** True bila model id kemungkinan mendukung parameter reasoning. */
export function supportsReasoning(modelId: string | null | undefined): boolean {
  const id = (modelId ?? "").trim().toLowerCase();
  if (!id) return false;
  return REASONING_PATTERNS.some((re) => re.test(id));
}

/** Normalisasi input UI/API menjadi effort valid, atau undefined bila off/kosong. */
export function normalizeReasoningEffort(value: unknown): ReasoningEffort | undefined {
  if (typeof value !== "string") return undefined;
  const v = value.trim().toLowerCase();
  if (v === "low" || v === "medium" || v === "high") return v;
  return undefined;
}

/** Label Bahasa Indonesia untuk picker composer. */
export function reasoningEffortLabel(effort: ReasoningEffort | "off"): string {
  switch (effort) {
    case "low":
      return "Rendah";
    case "medium":
      return "Sedang";
    case "high":
      return "Tinggi";
    default:
      return "Mati";
  }
}

/** Hint singkat per level untuk tooltip picker. */
export function reasoningEffortHint(effort: ReasoningEffort | "off"): string {
  switch (effort) {
    case "low":
      return "Penalaran cepat, hemat token.";
    case "medium":
      return "Seimbang untuk diagnosis umum.";
    case "high":
      return "Penalaran maksimal untuk kasus rumit.";
    default:
      return "Tanpa penalaran ekstra.";
  }
}
