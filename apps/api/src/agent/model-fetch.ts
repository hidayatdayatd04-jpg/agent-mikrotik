import { AppError } from "../lib/errors";
import type { Logger } from "../lib/logger";
import { defaultBaseUrl, type ProviderKind } from "./provider-settings";

/**
 * Auto-fetch model list from a provider (M7 revision). Called from the backend
 * with the user-supplied key so the browser never needs key material or a
 * direct CORS path to the provider. All providers expose their model list over
 * standard endpoints:
 *   - Gemini: Google native GET /v1beta/models (filter generateContent)
 *   - OpenRouter / custom: OpenAI-compatible GET {base}/models
 */

export interface FetchedModel {
  id: string;
  label?: string;
  contextWindow?: number;
  contextBasis?: "input" | "total";
}

const FETCH_TIMEOUT_MS = 12_000;
const MAX_MODELS = 300;

export async function fetchProviderModels(input: {
  kind: ProviderKind;
  baseUrl?: string;
  apiKey: string;
  logger: Logger;
  selectedModel?: string;
}): Promise<{ models: FetchedModel[]; source: string }> {
  const base = (input.baseUrl?.trim() || defaultBaseUrl(input.kind)).replace(/\/+$/, "");
  if (!base) throw new AppError("VALIDATION_FAILED", "Base URL wajib untuk provider custom.", 422);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    if (input.kind === "gemini" && (!input.baseUrl || base === defaultBaseUrl("gemini"))) {
      // native Google endpoint when using the default base URL
      const url = `https://generativelanguage.googleapis.com/v1beta/models?pageSize=${MAX_MODELS}`;
      const res = await fetch(url, {
        headers: { "x-goog-api-key": input.apiKey },
        signal: controller.signal,
      });
      if (!res.ok) {
        throw await providerError(res, "Gemini");
      }
      const data = (await res.json()) as { models?: { name?: string; displayName?: string; inputTokenLimit?: number; supportedGenerationMethods?: string[] }[] };
      const models = (data.models ?? [])
        .filter((m) => (m.supportedGenerationMethods ?? []).includes("generateContent"))
        .map((m) => ({
          id: (m.name ?? "").replace(/^models\//, ""),
          label: m.displayName,
          ...(validLimit(m.inputTokenLimit) ? { contextWindow: m.inputTokenLimit, contextBasis: "input" as const } : {}),
        }))
        .filter((m) => m.id && (!input.selectedModel || m.id === input.selectedModel))
        .slice(0, MAX_MODELS);
      return { models, source: "gemini:/v1beta/models" };
    }

    // OpenAI-compatible: OpenRouter, custom, or Gemini with explicit base URL
    const res = await fetch(`${base}/models`, {
      headers: { Authorization: `Bearer ${input.apiKey}` },
      signal: controller.signal,
    });
    if (!res.ok) {
      throw await providerError(res, input.kind === "openrouter" ? "OpenRouter" : "Provider");
    }
    const data = (await res.json()) as { data?: { id?: string; name?: string; context_length?: number }[] };
    const models = (data.data ?? [])
      .map((m) => ({ id: m.id ?? "", label: m.name, ...(validLimit(m.context_length) ? { contextWindow: m.context_length, contextBasis: "total" as const } : {}) }))
      .filter((m) => m.id && (!input.selectedModel || m.id === input.selectedModel))
      .slice(0, MAX_MODELS);
    return { models, source: `${base}/models` };
  } catch (err) {
    if (err instanceof AppError) throw err;
    if (err instanceof Error && err.name === "AbortError") {
      throw new AppError("UPSTREAM_TIMEOUT", "Provider tidak merespons dalam batas waktu saat mengambil daftar model.", 504);
    }
    input.logger.warn("model fetch failed", { error: err instanceof Error ? err.message : String(err) });
    throw new AppError("UPSTREAM_ERROR", "Gagal mengambil daftar model dari provider. Periksa API key dan base URL.", 502);
  } finally {
    clearTimeout(timer);
  }
}

function validLimit(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

async function providerError(res: Response, who: string): Promise<AppError> {
  const body = (await res.text().catch(() => "")).slice(0, 300);
  if (res.status === 401 || res.status === 403) {
    return new AppError("UPSTREAM_AUTH_FAILED", `${who} menolak kredensial (401/403). Periksa API key.`, 400);
  }
  return new AppError("UPSTREAM_ERROR", `${who} mengembalikan status ${res.status}. ${body}`, 502);
}
