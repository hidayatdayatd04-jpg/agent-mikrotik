import { AppError } from "../../lib/errors";
import { redactText } from "../../lib/redaction";
import type { SdkChunk, TurnCtx, TurnTicket } from "./context";
import { toProviderError } from "./errors";
import { extractRequestId, handleProviderFailure, type FailureCtx } from "./openai-failure";

/** Queue terpusat: tahan sampai kapasitas RPM/TPM tersedia (+ mapping error antrean). */
export async function acquireTurnTicket(ctx: TurnCtx): Promise<TurnTicket> {
  const { cfg, limiter, modelKey, sharedKey, estimated, input } = ctx;
  try {
    return await limiter.acquire({
      modelKey,
      providerKind: cfg.kind,
      sharedKey,
      estimatedTokens: estimated,
      signal: input.signal,
    });
  } catch (err) {
    // Antrean penuh / timeout / kuota harian → teruskan sebagai AppError.
    if (err instanceof AppError) throw err;
    const e = err as Error & { code?: string; retryAt?: string };
    if (e?.code === "QUOTA_EXHAUSTED" || e?.code === "RATE_LIMITED" || e?.code === "CANCELLED") {
      throw new AppError(
        e.code === "CANCELLED" ? "UPSTREAM_TIMEOUT" : e.code === "QUOTA_EXHAUSTED" ? "UPSTREAM_QUOTA_EXHAUSTED" : "UPSTREAM_RATE_LIMITED",
        e.message,
        e.code === "CANCELLED" ? 504 : 502,
      );
    }
    throw toProviderError(err, cfg);
  }
}

export type TurnRequestOutcome =
  | { stream: AsyncIterable<SdkChunk> }
  | { retryAfterMs: number };

/** 400 yang menyebut temperature = model menolak parameter tersebut. */
function isTemperatureRejection(err: unknown): boolean {
  const e = err as { status?: number; message?: string; error?: { message?: string } } | null;
  const status = typeof e?.status === "number" ? e.status : 0;
  const msg = String(e?.error?.message ?? e?.message ?? (err instanceof Error ? err.message : ""));
  return (status === 400 || /invalid[ _-]?argument/i.test(msg)) && /temperature/i.test(msg);
}

/** 400 yang menyebut reasoning_effort/reasoning = model menolak parameter reasoning. */
function isReasoningRejection(err: unknown): boolean {
  const e = err as { status?: number; message?: string; error?: { message?: string } } | null;
  const status = typeof e?.status === "number" ? e.status : 0;
  const msg = String(e?.error?.message ?? e?.message ?? (err instanceof Error ? err.message : ""));
  return (status === 400 || /invalid[ _-]?argument/i.test(msg) || /unsupported/i.test(msg)) && /reasoning/i.test(msg);
}

/** 400 yang menyebut max_tokens = model reasoning baru minta max_completion_tokens. */
function isMaxTokensRejection(err: unknown): boolean {
  const e = err as { status?: number; message?: string; error?: { message?: string } } | null;
  const status = typeof e?.status === "number" ? e.status : 0;
  const msg = String(e?.error?.message ?? e?.message ?? (err instanceof Error ? err.message : ""));
  return status === 400 && /max_tokens|max_completion_tokens/i.test(msg);
}

/** Satu upaya HTTP ke provider; retry/backoff terbatas untuk 429 biasa. */
export async function requestTurnStream(ctx: TurnCtx, ticket: TurnTicket, attempt: number): Promise<TurnRequestOutcome> {
  const { cfg, logger, limiter, modelKey, client, input, diag, endpointHost, wireMessages, wireTools, maxRetries } = ctx;
  const failureCtx: FailureCtx = { cfg, logger, limiter, modelKey, sharedKey: ctx.sharedKey };
  input.onRequestAttempt?.();
  try { input.onQueueWait?.(ticket.waitedMs); } catch { /* telemetry non-fatal */ }
  logger.debug("provider request attempt", {
    provider: cfg.kind,
    model: cfg.model,
    endpoint: endpointHost,
    attempt: attempt + 1,
    reasoningEffort: ctx.reasoningEffort ?? "default",
    ...diag,
  });
  // Pembuatan request dengan fallback berlapis agar model reasoning
  // (o1/o3/gpt-5, Gemini thinking, DeepSeek-R1, QwQ, ...) tetap jalan:
  //  1. coba sesuai permintaan (temperature + reasoning_effort + max_tokens);
  //  2. bila 400 menyebut temperature → ulangi tanpa temperature;
  //  3. bila 400 menyebut reasoning → ulangi tanpa reasoning_effort;
  //  4. bila 400 menyebut max_tokens → ulangi dengan max_completion_tokens.
  // Urutan 2-4 bisa kombinasi; tiap fallback dicoba maksimal sekali.
  const doCreate = (temperature: number | null, reasoningEffort: string | null, useCompletionTokens: boolean) =>
    client.chat.completions.create({
      model: cfg.model,
      messages: wireMessages as never,
      tools: wireTools.length ? wireTools : undefined,
      ...(useCompletionTokens ? { max_completion_tokens: input.maxTokens } : { max_tokens: input.maxTokens }),
      ...(temperature !== null ? { temperature } : {}),
      // reasoning_effort (low/medium/high): didukung model reasoning
      // OpenAI o-series/gpt-5, Gemini thinking via OpenAI-compat, dan
      // DeepSeek/Qwen via OpenRouter. SDK versi lama belum mengetiknya —
      // cast aman karena provider yang tak kenal akan 400 lalu di-fallback.
      ...(reasoningEffort !== null ? { reasoning_effort: reasoningEffort } : {}),
      stream: true,
      stream_options: { include_usage: true },
    } as never, { signal: input.signal });
  const attemptCreate = async (): Promise<Awaited<ReturnType<typeof doCreate>>> => {
    let temperature = ctx.temperature;
    let reasoning: string | null = ctx.reasoningEffort;
    let useCompletionTokens = false;
    for (;;) {
      try {
        return await doCreate(temperature, reasoning, useCompletionTokens);
      } catch (err) {
        if (temperature !== null && isTemperatureRejection(err)) {
          logger.warn("provider rejected temperature param; retrying without it", {
            provider: cfg.kind,
            model: cfg.model,
            endpoint: endpointHost,
          });
          temperature = null;
          continue;
        }
        if (reasoning !== null && isReasoningRejection(err)) {
          logger.warn("provider rejected reasoning_effort param; retrying without it", {
            provider: cfg.kind,
            model: cfg.model,
            endpoint: endpointHost,
          });
          reasoning = null;
          continue;
        }
        if (!useCompletionTokens && isMaxTokensRejection(err)) {
          logger.warn("provider rejected max_tokens param; retrying with max_completion_tokens", {
            provider: cfg.kind,
            model: cfg.model,
            endpoint: endpointHost,
          });
          useCompletionTokens = true;
          continue;
        }
        throw err;
      }
    }
  };
  try {
    const stream = await attemptCreate();
    return { stream: stream as unknown as AsyncIterable<SdkChunk> };
  } catch (err) {
    const mapped = handleProviderFailure(failureCtx, err, { attempt, maxRetries });
    if (mapped.retry) {
      return { retryAfterMs: mapped.waitMs };
    }
    ticket.abandon();
    logger.warn("provider stream request failed", {
      provider: cfg.kind,
      model: cfg.model,
      endpoint: endpointHost,
      attempt: attempt + 1,
      ...diag,
      code: mapped.error.code,
      retryable: false,
      requestId: extractRequestId(err),
      error: redactText(mapped.error.message).slice(0, 300),
    });
    throw mapped.error;
  }
}
