import { RATE_WINDOW_MS, type EffectiveLimits } from "./types";

export interface Bucket {
  requests: number[];
  tokens: { ts: number; tokens: number }[];
}

export function sumTokens(bucket: Bucket): number {
  let s = 0;
  for (const e of bucket.tokens) s += e.tokens;
  return s;
}

/** Rolling/sliding window 60 detik per bucket model maupun shared (#3). */
export class BucketStore {
  private buckets = new Map<string, Bucket>();

  bucketFor(key: string): Bucket {
    let b = this.buckets.get(key);
    if (!b) {
      b = { requests: [], tokens: [] };
      this.buckets.set(key, b);
    }
    return b;
  }

  prune(bucket: Bucket, now: number): void {
    const cutoff = now - RATE_WINDOW_MS;
    while (bucket.requests.length > 0 && bucket.requests[0]! <= cutoff) bucket.requests.shift();
    while (bucket.tokens.length > 0 && bucket.tokens[0]!.ts <= cutoff) bucket.tokens.shift();
  }

  keys(): Iterable<string> {
    return this.buckets.keys();
  }

  reset(): void {
    this.buckets.clear();
  }

  /** Waktu tunggu (ms) sampai `estimatedTokens` muat pada satu bucket. 0 = muat. */
  waitForBucket(
    bucketKey: string,
    limit: EffectiveLimits,
    estimatedTokens: number,
    now: number,
    blockedUntil: number | null,
  ): { waitMs: number; rpmUsed: number; tpmUsed: number } {
    const bucket = this.bucketFor(bucketKey);
    this.prune(bucket, now);
    if (blockedUntil !== null) {
      return { waitMs: Math.max(0, blockedUntil - now), rpmUsed: bucket.requests.length, tpmUsed: sumTokens(bucket) };
    }

    // Bila satu request saja sudah melebihi TPM, tetap antre sampai jendela kosong total.
    if (estimatedTokens > limit.tpm) {
      if (bucket.tokens.length === 0 && bucket.requests.length === 0) return { waitMs: 0, rpmUsed: 0, tpmUsed: 0 };
      const oldestToken = bucket.tokens[0]?.ts ?? bucket.requests[0] ?? now;
      const oldestReq = bucket.requests[0] ?? oldestToken;
      return { waitMs: Math.max(0, Math.min(oldestToken, oldestReq) + RATE_WINDOW_MS - now), rpmUsed: bucket.requests.length, tpmUsed: sumTokens(bucket) };
    }

    if (bucket.requests.length >= limit.rpm) {
      const oldest = bucket.requests[0] ?? now;
      return { waitMs: Math.max(0, oldest + RATE_WINDOW_MS - now), rpmUsed: bucket.requests.length, tpmUsed: sumTokens(bucket) };
    }
    const used = sumTokens(bucket);
    if (used + estimatedTokens > limit.tpm) {
      // Tunggu entry token tertua kedaluwarsa, lalu cek ulang (loop di acquire).
      const oldest = bucket.tokens[0]?.ts ?? bucket.requests[0] ?? now;
      return { waitMs: Math.max(0, oldest + RATE_WINDOW_MS - now), rpmUsed: bucket.requests.length, tpmUsed: used };
    }
    return { waitMs: 0, rpmUsed: bucket.requests.length, tpmUsed: used };
  }

  /** Reservasi: catat 1 request + estimasi token pada tiap bucket terkait. */
  reserve(bucketKeys: string[], at: number, estimatedTokens: number): void {
    for (const bucketKey of bucketKeys) {
      const b = this.bucketFor(bucketKey);
      this.prune(b, at);
      b.requests.push(at);
      b.tokens.push({ ts: at, tokens: Math.max(1, Math.floor(estimatedTokens)) });
    }
  }

  /** Rekonsiliasi reservasi estimasi dengan token aktual dari respons API. */
  reconcile(bucketKeys: string[], at: number, actualTokens: number | null): void {
    if (actualTokens === null || !Number.isFinite(actualTokens)) return;
    const actual = Math.max(1, Math.floor(actualTokens));
    for (const bucketKey of bucketKeys) {
      const b = this.buckets.get(bucketKey);
      if (!b || b.tokens.length === 0) continue;
      // Koreksi entry reservasi terakhir agar total jendela = aktual, bukan estimasi+ganda.
      for (let i = b.tokens.length - 1; i >= 0; i--) {
        if (b.tokens[i]!.ts === at) {
          b.tokens[i] = { ts: at, tokens: actual };
          break;
        }
      }
    }
  }
}
