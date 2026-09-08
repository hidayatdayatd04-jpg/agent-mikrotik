import type { ChatClient } from "./chat-client";
import {
  type CentralRateLimiter,
  classifyQuotaError,
  globalRateLimiter,
  modelKeyFor,
  sharedKeyForApiKey,
} from "./rate-limiter";
import { isDailyQuotaError } from "./provider-limits";

/**
 * Fallback antar model yang kompatibel + checkpoint menunggu kuota (#6).
 *
 * - Bila model primer terkena rate limit / kuota harian habis, pilih model
 *   cadangan yang kompatibel (enabled, tidak diblokir, bukan primer).
 * - Bila semua provider tidak tersedia: simpan checkpoint task dan kembalikan
 *   status menunggu kuota TANPA melempar crash; loop/chat route menampilkan
 *   status tersebut ke UI.
 * - Read-only guarantee (#8): fallback & pemulihan TIDAK PERNAH mengubah mode
 *   policy. Mode diteruskan apa adanya oleh pemanggil; modul ini tidak menyentuh
 *   tools tulis maupun transaksi Safe Mode.
 */

export interface FallbackCandidate {
  providerId: string;
  providerKind: string;
  model: string;
  enabled: boolean;
  /** Fingerprint API key untuk shared quota; dihitung dari apiKey bila ada. */
  sharedKey?: string | null;
  apiKey?: string;
}

export function candidateKey(c: Pick<FallbackCandidate, "providerKind" | "model">): string {
  return modelKeyFor(c.providerKind, c.model);
}

export function sharedKeyForCandidate(c: FallbackCandidate): string | null {
  if (c.sharedKey) return c.sharedKey;
  if (c.apiKey) {
    try {
      return sharedKeyForApiKey(c.apiKey);
    } catch {
      return null;
    }
  }
  return null;
}

/** Pilih kandidat fallback pertama yang tidak diblokir limiter. */
export function pickFallbackCandidate(
  primaryModelKey: string,
  candidates: FallbackCandidate[],
  limiter: CentralRateLimiter = globalRateLimiter,
): FallbackCandidate | null {
  for (const c of candidates) {
    if (!c.enabled) continue;
    const key = candidateKey(c);
    if (key === primaryModelKey) continue;
    const shared = sharedKeyForCandidate(c);
    const blocked = limiter.isBlocked(key, shared);
    if (blocked.blocked) continue;
    return c;
  }
  return null;
}

export interface FallbackStreamResult {
  client: ChatClient;
  modelKey: string;
  candidate: FallbackCandidate | null;
  fallbackReason: string | null;
}

/** Klasifikasi error stream untuk keputusan retry vs fallback vs checkpoint. */
export function describeStreamFailure(status: number, message: string): {
  kind: "daily_quota" | "rate_limit" | "other";
  shouldFallback: boolean;
} {
  // 400 invalid-argument TIDAK PERNAH fallback: payload yang sama akan
  // ditolak semua model — fallback hanya membakar kuota. (Cek dulu karena
  // pesan 400 menyebut kata "kuota" pada himbauan hemat-kuota.)
  if (status === 400 || /\(400\)|invalid[ _-]?argument|argumen tidak valid|UPSTREAM_INVALID_REQUEST/i.test(message)) {
    return { kind: "other", shouldFallback: false };
  }
  if (isDailyQuotaError(status, message)) return { kind: "daily_quota", shouldFallback: true };
  const c = classifyQuotaError(status, message);
  if (c.kind === "rate_limit" || status === 429) return { kind: "rate_limit", shouldFallback: true };
  return { kind: "other", shouldFallback: false };
}

export function guessStatus(message: string): number {
  if (/\(400\)|invalid[ _-]?argument|argumen tidak valid/i.test(message)) return 400;
  if (/429|rate limit|kuota/i.test(message)) return 429;
  if (/kuota harian|daily|RPD/i.test(message)) return 429;
  return 0;
}
