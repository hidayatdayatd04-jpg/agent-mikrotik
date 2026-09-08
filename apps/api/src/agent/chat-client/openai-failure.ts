import { AppError } from "../../lib/errors";
import type { Logger } from "../../lib/logger";
import type { CentralRateLimiter } from "../rate-limiter";
import { classifyQuotaError, computeBackoffWithJitter, nextMidnightUtcMs, parseRetryAfterMs } from "../rate-limiter";
import type { ProviderConfigWithKey } from "../provider-settings";
import { toProviderError } from "./errors";

export interface FailureCtx {
  cfg: ProviderConfigWithKey;
  logger: Logger;
  limiter: CentralRateLimiter;
  modelKey: string;
  sharedKey: string | null;
}

export function handleProviderFailure(
  ctx: FailureCtx,
  err: unknown,
  attemptInfo: { attempt: number; maxRetries: number },
): { retry: boolean; daily: boolean; waitMs: number; error: AppError } {
  const { cfg, logger, limiter, modelKey, sharedKey } = ctx;
  const apiErr = err as { status?: number; headers?: unknown; message?: string; error?: { message?: string; code?: string | number } } | null;
  const status = typeof apiErr?.status === "number" ? apiErr.status : 0;
  const raw = String(apiErr?.error?.message || apiErr?.message || (err instanceof Error ? err.message : String(err)));
  const classified = classifyQuotaError(status === 0 && /resource_exhausted|rate limit|quota/i.test(raw) ? 429 : status, raw);
  const retryMs = extractRetryMs(err) ?? computeBackoffWithJitter(attemptInfo.attempt);

  if (classified.isDaily) {
    const resetAt = extractRetryMs(err) !== null ? Date.now() + (extractRetryMs(err) as number) : nextMidnightUtcMs(Date.now());
    limiter.notifyDailyQuotaExhausted({ modelKey, sharedKey, resetAtMs: resetAt, reason: raw.slice(0, 300) });
    limiter.setFallbackReason(modelKey, `Kuota harian habis pada ${modelKey}; fallback ke model cadangan.`);
    return { retry: false, daily: true, waitMs: 0, error: toProviderError(err, cfg) };
  }
  const isRateLimited = status === 429 || (apiErr?.error?.code as unknown) === 429 || classified.kind === "rate_limit";
  if (isRateLimited) {
    limiter.notifyRateLimited({ modelKey, sharedKey, retryAtMs: Date.now() + retryMs, reason: raw.slice(0, 300) });
    if (attemptInfo.attempt < attemptInfo.maxRetries) {
      limiter.setFallbackReason(modelKey, `Rate limit sementara pada ${modelKey} (retry ${attemptInfo.attempt + 1}/${attemptInfo.maxRetries}).`);
      logger.warn("provider 429 — backoff dengan jitter sebelum retry terbatas", { model: modelKey, waitMs: retryMs, attempt: attemptInfo.attempt });
      return { retry: true, daily: false, waitMs: retryMs, error: toProviderError(err, cfg) };
    }
    return { retry: false, daily: false, waitMs: 0, error: toProviderError(err, cfg) };
  }
  return { retry: false, daily: false, waitMs: 0, error: toProviderError(err, cfg) };
}

export function extractRequestId(err: unknown): string | null {
  const e = err as {
    headers?: Headers | Record<string, string>;
    requestID?: string;
    error?: { requestID?: string };
  } | null;
  try {
    if (typeof e?.requestID === "string" && e.requestID) return e.requestID.slice(0, 64);
    if (typeof e?.error?.requestID === "string" && e.error.requestID) return e.error.requestID.slice(0, 64);
    const h = e?.headers;
    if (h instanceof Headers) {
      const v = h.get("x-request-id") ?? h.get("request-id");
      return v ? v.slice(0, 64) : null;
    }
    if (h && typeof h === "object") {
      const lower = Object.fromEntries(Object.entries(h).map(([k, v]) => [k.toLowerCase(), String(v)]));
      const v = lower["x-request-id"] ?? lower["request-id"];
      return v ? String(v).slice(0, 64) : null;
    }
  } catch { /* abaikan */ }
  return null;
}

export function extractRetryMs(err: unknown): number | null {
  const e = err as { headers?: Headers | Record<string, string>; status?: number; message?: string; error?: { message?: string } } | null;
  const now = Date.now();
  // Header Retry-After bila SDK menyertakannya
  try {
    const h = e?.headers as Headers | Record<string, string> | undefined;
    let raw: string | null = null;
    if (h instanceof Headers) raw = h.get("retry-after");
    else if (h && typeof h === "object") {
      const lower = Object.fromEntries(Object.entries(h).map(([k, v]) => [k.toLowerCase(), String(v)]));
      raw = lower["retry-after"] ?? null;
    }
    const parsed = parseRetryAfterMs(raw, now);
    if (parsed !== null) return parsed;
  } catch { /* abaikan */ }
  const msg = String((e as { error?: { message?: string } })?.error?.message || (e as { message?: string })?.message || "");
  const m = msg.match(/retry in\s+([\d.]+)\s*s/i) || msg.match(/retryDelay["']?\s*:\s*["']?([\d.]+)s/i) || msg.match(/try again in\s+([\d.]+)\s*s/i);
  if (m) {
    const sec = Number(m[1]);
    if (Number.isFinite(sec)) return Math.min(sec * 1000, 24 * 3600_000);
  }
  return null;
}

export function sleepWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  if (signal?.aborted) return Promise.reject(new AppError("UPSTREAM_TIMEOUT", "Permintaan dibatalkan.", 504));
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, Math.min(ms, 30_000));
    const onAbort = () => {
      clearTimeout(t);
      reject(new AppError("UPSTREAM_TIMEOUT", "Permintaan dibatalkan.", 504));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
