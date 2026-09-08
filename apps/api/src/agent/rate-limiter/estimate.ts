import { createHash } from "node:crypto";

export function clampPositiveInt(v: unknown, fallback: number): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

export function minPositive(...values: (number | undefined | null)[]): number {
  let out: number | null = null;
  for (const v of values) {
    if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) continue;
    out = out === null ? v : Math.min(out, v);
  }
  return out ?? Number.POSITIVE_INFINITY;
}

/** Fingerprint aman untuk API key agar model berbagi key memakai bucket bersama. */
export function sharedKeyForApiKey(apiKey: string): string {
  return `key:${createHash("sha256").update(apiKey).digest("hex").slice(0, 16)}`;
}

export function modelKeyFor(providerKind: string, model: string): string {
  return `${providerKind}:${model}`;
}

/** Estimasi token konservatif: ~3.5 char per token (ID/EN + output RouterOS). */
export function estimateTokensFromChars(chars: number): number {
  return Math.max(1, Math.ceil(chars / 3.5));
}

/**
 * Estimasi total token (input + output reserve) sebelum request.
 * Dipakai untuk pre-check TPM; direkonsiliasi dengan token aktual setelahnya.
 */
export function estimateRequestTokens(input: {
  messages: { content: string | null }[];
  tools?: unknown;
  maxTokens: number;
}): number {
  let chars = 0;
  for (const m of input.messages) chars += (m.content ?? "").length;
  if (input.tools !== undefined) {
    try {
      chars += JSON.stringify(input.tools).length;
    } catch {
      chars += 2000;
    }
  }
  // overhead framing untuk role/tool-call JSON
  chars += input.messages.length * 24;
  const inputEst = estimateTokensFromChars(chars);
  const outputReserve = clampPositiveInt(input.maxTokens, 1);
  return inputEst + outputReserve;
}

/** Backoff eksponensial dengan jitter: base * 2^attempt + jitter(0..1s). */
export function computeBackoffWithJitter(attempt: number, baseMs = 1000, capMs = 60_000, jitterMs = Math.random() * 1000): number {
  const exp = baseMs * 2 ** Math.max(0, attempt);
  return Math.min(capMs, exp + Math.max(0, jitterMs));
}

/** Parse Retry-After: detik / "12s" / HTTP-date / ms number. */
export function parseRetryAfterMs(raw: string | null | undefined, now: number): number | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  if (!s) return null;
  // "12s" / "11.4s"
  const secMatch = s.match(/^([\d.]+)\s*s$/i);
  if (secMatch) {
    const sec = Number(secMatch[1]);
    if (Number.isFinite(sec) && sec >= 0) return Math.min(sec * 1000, 24 * 3600_000);
  }
  // detik murni
  if (/^[\d.]+$/.test(s)) {
    const sec = Number(s);
    if (Number.isFinite(sec) && sec >= 0) return Math.min(sec * 1000, 24 * 3600_000);
  }
  // HTTP date
  const parsed = Date.parse(s);
  if (Number.isFinite(parsed)) return Math.max(0, parsed - now);
  return null;
}

const DAILY_PATTERNS =
  /daily|per[ _-]?day|\bRPD\b|per[ _-]?24h|24\s*hours?|GenerateRequestsPerDay|requests[ _-]?per[ _-]?day|day[ _-]?quota|quota[ _-]?per[ _-]?day|daily[ _-]?limit|quota.*(day|daily)|(day|daily).*quota/i;

export type QuotaKind = "daily_quota" | "rate_limit" | "other";

export function classifyQuotaError(status: number, message: string): { kind: QuotaKind; isDaily: boolean } {
  const msg = message ?? "";
  if (status === 429 || status === 403) {
    if (DAILY_PATTERNS.test(msg)) return { kind: "daily_quota", isDaily: true };
    // Frasa kuota generik tanpa kata "daily" tetap dianggap rate limit biasa
    // kecuali ada penanda harian yang jelas — agar tidak salah memblokir 24 jam.
    return { kind: status === 429 ? "rate_limit" : "other", isDaily: false };
  }
  if (/quota exceeded|resource_exhausted|rate limit exceeded/i.test(msg) && DAILY_PATTERNS.test(msg)) {
    return { kind: "daily_quota", isDaily: true };
  }
  return { kind: "other", isDaily: false };
}

/** Tengah malam UTC berikutnya — reset alami untuk kuota harian bila provider tak memberi waktu. */
export function nextMidnightUtcMs(now: number): number {
  const d = new Date(now);
  d.setUTCHours(24, 0, 0, 0);
  return d.getTime();
}
