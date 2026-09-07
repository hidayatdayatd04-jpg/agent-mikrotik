/**
 * Interactive Q&A cards ("pop-up pertanyaan"): when the assistant is blocked
 * on a user decision it may emit a fenced ask block instead of plain-text
 * questions. The chat renders each question with clickable options; tapping
 * an option sends it as the reply.
 *
 * Wire format (emitted by the model, see the human-response skill):
 *
 * ```ask
 * {"questions":[{"id":"q1","text":"...","options":[{"id":"a","label":"...","recommended":true}]}]}
 * ```
 *
 * Rules: max 3 questions, 2-4 options each. Options can have an optional
 * `recommended` boolean — when present, the UI offers a one-click
 * "Terapkan Rekomendasi" button that auto-selects all recommended options.
 * Anything unparseable falls back to plain text rendering.
 */

export interface AskOption {
  id: string;
  label: string;
  /** When true, this option is pre-recommended by the AI. */
  recommended?: boolean;
}

export interface AskQuestion {
  id: string;
  text: string;
  options: AskOption[];
}

export interface AskSpec {
  questions: AskQuestion[];
}

const FENCE_RE = /```ask\s*\n([\s\S]*?)\n?```/g;

function isAskSpec(value: unknown): value is AskSpec {
  if (!value || typeof value !== "object") return false;
  const questions = (value as { questions?: unknown }).questions;
  if (!Array.isArray(questions) || questions.length === 0 || questions.length > 3) return false;
  return questions.every((q) => {
    if (!q || typeof q !== "object") return false;
    const { id, text, options } = q as Record<string, unknown>;
    if (typeof id !== "string" || !id || typeof text !== "string" || !text) return false;
    if (!Array.isArray(options) || options.length < 2 || options.length > 4) return false;
    return options.every(
      (o) =>
        o && typeof o === "object" &&
        typeof (o as Record<string, unknown>).id === "string" &&
        (o as Record<string, unknown>).id !== "" &&
        typeof (o as Record<string, unknown>).label === "string" &&
        ((o as Record<string, unknown>).label as string).length > 0 &&
        ((o as Record<string, unknown>).recommended === undefined ||
          typeof (o as Record<string, unknown>).recommended === "boolean"),
    );
  });
}

/** Check if an option is marked recommended (either via recommended: true or label text). */
export function isOptionRecommended(o: AskOption): boolean {
  return o.recommended === true || /\(?(?:rekomendasi|recommended)\)?/i.test(o.label);
}

/** Parse all ask blocks in a message. Returns null when none are valid. */
export function extractAskBlocks(text: string): AskSpec[] | null {
  FENCE_RE.lastIndex = 0;
  const out: AskSpec[] = [];
  let m: RegExpExecArray | null;
  while ((m = FENCE_RE.exec(text)) !== null) {
    try {
      const parsed: unknown = JSON.parse(m[1] ?? "");
      if (isAskSpec(parsed)) out.push(parsed);
    } catch {
      /* invalid JSON → ignored, fence stripped by stripAskBlocks */
    }
  }
  return out.length > 0 ? out : null;
}

/** Remove ask fences, keeping surrounding prose (and inner text on parse failure). */
export function stripAskBlocks(text: string): string {
  FENCE_RE.lastIndex = 0;
  return text
    .replace(FENCE_RE, (_full, inner: string) => {
      try {
        const parsed: unknown = JSON.parse(inner ?? "");
        if (isAskSpec(parsed)) return "";
      } catch {
        /* fall through: keep inner text as prose */
      }
      return `\n${inner ?? ""}\n`;
    })
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
