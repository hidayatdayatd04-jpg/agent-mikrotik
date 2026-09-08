import type { ResearchResult } from "@shared/index";

/**
 * Structured Deep Research payload for the chat canvas: parsed from web: tool
 * output so the UI can render source cards (title/url/snippet) instead of raw
 * tool output. Data is untrusted internet content — never router data.
 */
export function extractResearchPayload(fqName: string, result: { ok: boolean; output: string }): ResearchResult | null {
  if (!fqName.startsWith("web:") || !result.ok) return null;
  try {
    const parsed = JSON.parse(result.output) as { query?: unknown; answer?: unknown; results?: unknown };
    const rows = Array.isArray(parsed.results) ? parsed.results : [];
    const sources = rows
      .map((row) => {
        const rec = (row ?? {}) as Record<string, unknown>;
        return {
          title: String(rec.title ?? "").slice(0, 200),
          url: String(rec.url ?? "").slice(0, 600),
          snippet: String(rec.snippet ?? "").slice(0, 300),
        };
      })
      .filter((s) => /^https?:\/\//i.test(s.url))
      .slice(0, 10);
    return {
      query: String(parsed.query ?? "").slice(0, 400),
      answer: typeof parsed.answer === "string" && parsed.answer ? parsed.answer.slice(0, 800) : null,
      sources,
    };
  } catch {
    return null;
  }
}
