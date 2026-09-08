import type OpenAI from "openai";
import type { Logger } from "../../lib/logger";
import type { ProviderConfigWithKey } from "../provider-settings";
import { observeProviderResponse } from "../provider-limits";
import { toProviderError } from "./errors";
import type { SdkChunk, TurnCtx } from "./context";

/**
 * Custom fetch to unwrap Google Gemini's array error payloads `[{ "error": ... }]`
 * so the OpenAI SDK can properly read err.error.message instead of throwing "(no body)"
 */
export function buildGeminiAwareFetch(
  cfg: ProviderConfigWithKey,
  logger: Logger,
): NonNullable<ConstructorParameters<typeof OpenAI>[0]>["fetch"] {
  return async (url, init) => {
    const res = await fetch(url, init);
    const observe = async (body?: unknown) => {
      try { await cfg.onObservation?.(observeProviderResponse(res.status, res.headers, body)); }
      catch { logger.warn("provider limit observation could not be saved"); }
    };
    if (!res.ok) {
      const text = await res.text();
      let body: unknown;
      try { body = JSON.parse(text); } catch { /* non-JSON upstream */ }
      await observe(body);
      try {
        const parsed = JSON.parse(text);
        if (Array.isArray(parsed) && parsed.length > 0 && parsed[0]?.error) {
          return new Response(JSON.stringify(parsed[0]), {
            status: res.status,
            statusText: res.statusText,
            headers: res.headers,
          });
        }
      } catch {}
      return new Response(text, {
        status: res.status,
        statusText: res.statusText,
        headers: res.headers,
      });
    }
    await observe();
    return res;
  };
}

/** Bungkus stream SDK agar interupsi mid-stream terobservasi + terpetakan. */
export async function* wrapResilientChunks(ctx: TurnCtx, stream: AsyncIterable<SdkChunk>): AsyncGenerator<SdkChunk> {
  const { cfg, logger, input } = ctx;
  try {
    for await (const chunk of stream) yield chunk;
  } catch (err) {
    logger.warn("provider stream interrupted", {
      provider: cfg.kind,
      model: cfg.model,
      error: err instanceof Error ? err.message : String(err),
    });
    if (!input.signal?.aborted) {
      const code = Number((err as { status?: number; error?: { code?: number } })?.status ?? (err as { error?: { code?: number } })?.error?.code ?? 500);
      try { await cfg.onObservation?.(observeProviderResponse(code, new Headers(), err)); } catch { /* telemetry is non-fatal */ }
    }
    throw toProviderError(err, cfg);
  }
}
