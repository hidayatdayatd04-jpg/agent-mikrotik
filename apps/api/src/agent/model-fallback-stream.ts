import type { ChatClient } from "./chat-client";
import {
  type CentralRateLimiter,
  type CheckpointStore,
  globalCheckpoints,
  globalRateLimiter,
} from "./rate-limiter";
import {
  candidateKey,
  type FallbackCandidate,
  type FallbackStreamResult,
  pickFallbackCandidate,
  sharedKeyForCandidate,
} from "./model-fallback-candidates";

/**
 * Bungkus factory client dengan logika fallback.
 * `makeClientFor(candidate)` harus mengembalikan ChatClient yang SUDAH
 * terintegrasi rate limiter (queue/backoff/token accounting).
 */
export async function streamWithFallback(input: {
  primary: FallbackCandidate;
  candidates: FallbackCandidate[];
  makeClientFor: (c: FallbackCandidate) => ChatClient | Promise<ChatClient>;
  limiter?: CentralRateLimiter;
  checkpoints?: CheckpointStore;
  runContext?: { runId: string | null; conversationId: string | null; userId: string | null; userText: string | null; policyMode: "read-only" | "write" };
}): Promise<FallbackStreamResult> {
  const limiter = input.limiter ?? globalRateLimiter;
  const primaryKey = candidateKey(input.primary);
  const primaryShared = sharedKeyForCandidate(input.primary);
  const primaryBlocked = limiter.isBlocked(primaryKey, primaryShared);
  if (!primaryBlocked.blocked) {
    return { client: await input.makeClientFor(input.primary), modelKey: primaryKey, candidate: null, fallbackReason: null };
  }

  const reason = primaryBlocked.isDaily
    ? `Kuota harian ${primaryKey} habis; retry ${primaryBlocked.retryAt ?? "menunggu reset provider"}.`
    : `Rate limit ${primaryKey}; retry ${primaryBlocked.retryAt ?? "segera"}.`;
  limiter.setFallbackReason(primaryKey, reason);

  const fallback = pickFallbackCandidate(primaryKey, input.candidates, limiter);
  if (fallback) {
    const fbKey = candidateKey(fallback);
    const fbReason = `Fallback ${primaryKey} → ${fbKey}: ${reason}`;
    limiter.setFallbackReason(primaryKey, fbReason);
    return { client: await input.makeClientFor(fallback), modelKey: fbKey, candidate: fallback, fallbackReason: fbReason };
  }

  // Semua provider tidak tersedia → checkpoint + status menunggu (no crash).
  const store = input.checkpoints ?? globalCheckpoints;
  const attempted = [primaryKey, ...input.candidates.filter((c) => c.enabled).map(candidateKey)];
  const cp = store.save({
    runId: input.runContext?.runId ?? null,
    conversationId: input.runContext?.conversationId ?? null,
    userId: input.runContext?.userId ?? null,
    userText: input.runContext?.userText ?? null,
    primaryModelKey: primaryKey,
    attemptedModels: attempted,
    reason,
    fallbackReason: reason,
    policyMode: "read-only",
    nextRetryAt: primaryBlocked.retryAt,
  });
  const err = new Error(
    `Semua provider tidak tersedia (checkpoint ${cp.id}). ${reason} Task disimpan dan dapat dilanjutkan setelah kuota tersedia; tidak ada tool tulis yang dijalankan.`,
  ) as Error & { code: string; retryAt: string | null; checkpointId: string };
  err.code = primaryBlocked.isDaily ? "QUOTA_EXHAUSTED" : "RATE_LIMITED";
  err.retryAt = primaryBlocked.retryAt;
  err.checkpointId = cp.id;
  throw err;
}
