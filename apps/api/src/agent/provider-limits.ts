import type { ModelLimitStatus } from "@agent-mikrotik/shared";
import { classifyQuotaError } from "./rate-limiter";

/** Only observations from the upstream response; never an inferred quota. */
export function observeProviderResponse(status: number, headers: Headers, body?: unknown): ModelLimitStatus {
  const envelope = Array.isArray(body) ? body[0] : body;
  const error = (envelope as { error?: { code?: number; message?: string; metadata?: { headers?: Record<string, string> }; details?: { retryDelay?: string }[] } } | undefined)?.error;
  const all = new Headers(headers);
  for (const [name, value] of Object.entries(error?.metadata?.headers ?? {})) all.set(name, String(value));
  const numeric = (name: string) => {
    const raw = all.get(name);
    const n = raw === null || raw.trim() === "" ? NaN : Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : null;
  };
  const numericAny = (...names: string[]) => {
    for (const n of names) {
      const v = numeric(n);
      if (v !== null) return v;
    }
    return null;
  };
  const now = Date.now();
  const retry = all.get("retry-after") ?? error?.details?.find((d) => d.retryDelay)?.retryDelay;
  let retryAt: number | null = null;
  if (retry) {
    const seconds = Number(retry.replace(/s$/, ""));
    retryAt = Number.isFinite(seconds) ? now + Math.max(seconds, 0) * 1000 : Date.parse(retry);
  }
  const reset = numeric("x-ratelimit-reset");
  if (retryAt === null && reset !== null) retryAt = reset < 1e12 ? reset * 1000 : reset;
  const limited = status === 429 || error?.code === 429;
  const message = String((error as { message?: unknown } | undefined)?.message ?? "");
  const classified = classifyQuotaError(status, message);
  const isDaily = classified.isDaily;

  // RPD harian: hanya dari header/observasi provider, bukan estimasi lokal.
  const dailyLimit = numericAny(
    "x-ratelimit-limit-day",
    "x-ratelimit-limit-daily",
    "x-ratelimit-limit-requests-day",
    "x-ratelimit-limit-tokens-day",
  );
  const dailyRemaining = numericAny(
    "x-ratelimit-remaining-day",
    "x-ratelimit-remaining-daily",
    "x-ratelimit-remaining-requests-day",
    "x-ratelimit-remaining-tokens-day",
  );
  const dailyResetRaw = all.get("x-ratelimit-reset-day") ?? all.get("x-ratelimit-reset-daily");
  let dailyResetAt: string | null = null;
  if (dailyResetRaw) {
    const n = Number(dailyResetRaw);
    if (Number.isFinite(n)) dailyResetAt = new Date(n < 1e12 ? n * 1000 : n).toISOString();
    else {
      const parsed = Date.parse(dailyResetRaw);
      if (Number.isFinite(parsed)) dailyResetAt = new Date(parsed).toISOString();
    }
  }
  // Bila provider menandai kuota harian habis tanpa header RPD, tetap tandai
  // exhausted agar fallback/checkpoint aktif; RPD numerik tetap null.
  const dailyExhausted = isDaily || (limited && dailyRemaining === 0 && dailyLimit !== null);

  return {
    status: limited ? "limited" : status >= 200 && status < 300 ? "available" : "error",
    observedAt: new Date(now).toISOString(),
    retryAt: retryAt !== null && Number.isFinite(retryAt) && retryAt < 8.64e15 ? new Date(retryAt).toISOString() : null,
    requestsLimit: numeric("x-ratelimit-limit-requests") ?? numeric("x-ratelimit-limit"),
    requestsRemaining: numeric("x-ratelimit-remaining-requests") ?? numeric("x-ratelimit-remaining"),
    tokensLimit: numeric("x-ratelimit-limit-tokens"),
    tokensRemaining: numeric("x-ratelimit-remaining-tokens"),
    dailyLimit,
    dailyRemaining,
    dailyResetAt,
    isDailyQuotaExhausted: dailyExhausted || undefined,
  };
}

/** True bila error provider mengindikasikan kuota harian (RPD) habis. */
export function isDailyQuotaError(status: number, message: string): boolean {
  return classifyQuotaError(status, message).isDaily;
}
