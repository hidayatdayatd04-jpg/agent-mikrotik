import { createHash } from "node:crypto";
import { randomInt } from "node:crypto";
import { hmacDigest } from "../lib/crypto";
import { sql } from "drizzle-orm";
import type { Database } from "../db";

export type DbLike = Database;

/**
 * Persistent fixed-window rate limiter. Atomic single-statement upsert so
 * concurrent requests cannot slip past the limit.
 */
export function createRateLimiter(db: DbLike, secret: string) {
  const keyHash = (key: string) => createHash("sha256").update(`${secret}|${key}`).digest("hex");

  return async function consume(
    key: string,
    limit: number,
    windowSeconds: number,
  ): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
    const bucketKey = keyHash(key);
    const now = new Date();
    const windowStart = new Date(Math.floor(now.getTime() / (windowSeconds * 1000)) * windowSeconds * 1000);
    const expiresAt = new Date(windowStart.getTime() + windowSeconds * 1000);

    const rows = await db.execute(sql`
      INSERT INTO rate_limit_buckets (key_hash, window_start, count, expires_at)
      VALUES (${bucketKey}, ${windowStart.toISOString()}, 1, ${expiresAt.toISOString()})
      ON CONFLICT (key_hash, window_start) DO UPDATE
        SET count = rate_limit_buckets.count + 1
      RETURNING count
    `);
    const row = rows.rows?.[0];
    const count = Number(row?.count ?? 1);
    if (count > limit) {
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((expiresAt.getTime() - now.getTime()) / 1000),
      );
      return { allowed: false, retryAfterSeconds };
    }
    return { allowed: true, retryAfterSeconds: 0 };
  };
}

export function generateOtp(): string {
  const n = randomInt(0, 1_000_000);
  return n.toString().padStart(6, "0");
}

/**
 * Keyed digest binding email+challenge+purpose so a digest cannot be replayed
 * against a different challenge or purpose. Plaintext OTP is never stored.
 */
export function otpDigest(secret: string, challengeId: string, email: string, purpose: string, code: string): string {
  return hmacDigest(secret, "otp", challengeId, email.toLowerCase(), purpose, code);
}
