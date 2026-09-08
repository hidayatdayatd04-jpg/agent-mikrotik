import { AppError } from "../../lib/errors";

/** Sliding window per user (M10): cukup untuk deployment single-node. */
export function enforceRunRateLimit(
  runTimesByUser: Map<string, number[]>,
  limit: { maxRuns: number; windowMs: number },
  userId: string,
) {
  const now = Date.now();
  const cutoff = now - limit.windowMs;
  const times = (runTimesByUser.get(userId) ?? []).filter((t) => t > cutoff);
  if (times.length >= limit.maxRuns) {
    throw new AppError("RATE_LIMITED", `Batas ${limit.maxRuns} run chat per ${Math.round(limit.windowMs / 1000)} detik. Tunggu sebentar.`, 429);
  }
  times.push(now);
  runTimesByUser.set(userId, times);
  if (runTimesByUser.size > 10_000) {
    // prune cold entries to bound memory
    for (const [k, v] of runTimesByUser) {
      if (v.every((t) => t <= cutoff)) runTimesByUser.delete(k);
    }
  }
}
