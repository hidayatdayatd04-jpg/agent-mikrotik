import type { z } from "zod";
import type { Logger } from "../lib/logger";
import { WebSearchQuery } from "./web-search-definition";

export { WEB_SEARCH_FQ, WebSearchQuery, WEB_SEARCH_TOOL } from "./web-search-definition";

// --- Rate limit + cache internal (single-process; app ini single-user lokal) ---
// 20/menit: sesi deep research yang sah bisa memakan 5-10 putaran pencarian.
const RPM_LIMIT = 20;
const CACHE_TTL_MS = 5 * 60_000;
const REQUEST_TIMEOUT_MS = 15_000;
const requestLog = new Map<string, number[]>();
const resultCache = new Map<string, { expiresAt: number; value: string }>();

function withinRateLimit(userId: string): boolean {
  const now = Date.now();
  const arr = (requestLog.get(userId) ?? []).filter((t) => now - t < 60_000);
  if (arr.length >= RPM_LIMIT) {
    requestLog.set(userId, arr);
    return false;
  }
  arr.push(now);
  requestLog.set(userId, arr);
  return true;
}

interface TavilyResult { title?: string; url: string; content?: string; score?: number }
interface TavilyResponse { answer?: string; results?: TavilyResult[] }

async function callTavily(apiKey: string, args: z.infer<typeof WebSearchQuery>): Promise<TavilyResponse> {
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      query: args.query,
      search_depth: args.search_depth,
      max_results: args.max_results,
      topic: args.topic,
      ...(args.time_range ? { time_range: args.time_range } : {}),
      include_answer: true,
      include_raw_content: false,
      include_images: false,
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const err = new Error(`Tavily HTTP ${res.status}: ${text.slice(0, 300)}`) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return (await res.json()) as TavilyResponse;
}

/** Dipakai juga oleh route settings untuk validasi key sebelum disimpan (test-before-save). */
export async function verifyTavilyApiKey(apiKey: string): Promise<{ ok: boolean; message?: string }> {
  try {
    await callTavily(apiKey, WebSearchQuery.parse({ query: "test", max_results: 1 }));
    return { ok: true };
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 401 || status === 403) return { ok: false, message: "API key Tavily ditolak (tidak valid)." };
    return { ok: false, message: err instanceof Error ? err.message : "Gagal menghubungi Tavily." };
  }
}

export async function executeWebSearchTool(
  deps: { getApiKey: (userId: string) => Promise<string | null>; logger: Logger },
  input: { userId: string; args: unknown },
): Promise<{ ok: boolean; output: string; errorCode?: string }> {
  const parsed = WebSearchQuery.safeParse(input.args);
  if (!parsed.success) {
    return { ok: false, output: "Parameter pencarian tidak valid.", errorCode: "VALIDATION_FAILED" };
  }
  const apiKey = await deps.getApiKey(input.userId);
  if (!apiKey) {
    return {
      ok: false,
      errorCode: "WEB_SEARCH_NOT_CONFIGURED",
      output: "Pencarian web belum dikonfigurasi — API key Tavily belum diisi di Pengaturan → Deep Research.",
    };
  }
  if (!withinRateLimit(input.userId)) {
    return { ok: false, errorCode: "WEB_SEARCH_RATE_LIMITED", output: "Batas pencarian web tercapai (maks 20/menit). Coba lagi sebentar lagi." };
  }
  const cacheKey = `${input.userId}:${JSON.stringify(parsed.data)}`;
  const cached = resultCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return { ok: true, output: cached.value };
  }
  try {
    const data = await callTavily(apiKey, parsed.data);
    // Susun payload secara bertahap agar muat di bawah batas tanpa PERNAH
    // memotong string JSON-nya — JSON terpotong = JSON rusak (parser UI/model
    // gagal → kartu sumber kosong). Kecilkan cuplikan secara progresif.
    const build = (answerLen: number, snippetLen: number) => JSON.stringify({
      query: parsed.data.query,
      answer: typeof data.answer === "string" ? data.answer.slice(0, answerLen) : null,
      results: (data.results ?? []).slice(0, parsed.data.max_results).map((r) => ({
        title: r.title?.slice(0, 200) ?? "",
        url: r.url,
        snippet: r.content?.slice(0, snippetLen) ?? "",
      })),
      fetchedAt: new Date().toISOString(),
    });
    let output = build(600, 400);
    if (output.length > 6000) output = build(400, 250);
    if (output.length > 6000) output = build(250, 150);
    if (output.length > 6000) output = build(150, 0);
    resultCache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, value: output });
    return { ok: true, output };
  } catch (err) {
    const status = (err as { status?: number }).status;
    deps.logger.warn("tavily search failed", { status, message: err instanceof Error ? err.message : String(err) });
    if (status === 401 || status === 403) {
      return { ok: false, errorCode: "WEB_SEARCH_UNAUTHORIZED", output: "API key Tavily ditolak. Perbarui di Pengaturan → Deep Research." };
    }
    if (status === 429) {
      return { ok: false, errorCode: "WEB_SEARCH_RATE_LIMITED", output: "Tavily membatasi permintaan (429). Coba lagi sebentar lagi." };
    }
    if (err instanceof DOMException && err.name === "TimeoutError") {
      return { ok: false, errorCode: "TOOL_TIMEOUT", output: "Pencarian web tidak selesai dalam batas waktu." };
    }
    return { ok: false, errorCode: "TOOL_FAILED", output: "Pencarian web gagal dijalankan." };
  }
}