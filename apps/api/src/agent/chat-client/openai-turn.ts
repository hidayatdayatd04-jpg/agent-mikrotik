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
    ...diag,
  });
  try {
    const doCreate = (temperature: number | null) =>
      client.chat.completions.create({
        model: cfg.model,
        messages: wireMessages as never,
        tools: wireTools.length ? wireTools : undefined,
        max_tokens: input.maxTokens,
        ...(temperature !== null ? { temperature } : {}),
        stream: true,
        stream_options: { include_usage: true },
      }, { signal: input.signal });
    let stream: Awaited<ReturnType<typeof doCreate>>;
    try {
      stream = await doCreate(ctx.temperature);
    } catch (err) {
      // Model reasoning tertentu (mis. o1-style) menolak parameter
      // temperature — coba sekali tanpa parameter sebelum menyerah.
      if (ctx.temperature !== null && isTemperatureRejection(err)) {
        logger.warn("provider rejected temperature param; retrying without it", {
          provider: cfg.kind,
          model: cfg.model,
          endpoint: endpointHost,
        });
        stream = await doCreate(null);
      } else {
        throw err;
      }
    }
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
