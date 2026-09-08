import { AppError } from "../lib/errors";
import type { CentralRateLimiter, CheckpointStore } from "./rate-limiter";
import type { FallbackCandidate } from "./model-fallback-candidates";
import { candidateKey, sharedKeyForCandidate } from "./model-fallback-candidates";

export interface ExhaustedCheckpointInput {
  store: CheckpointStore;
  runContext?: { runId: string | null; conversationId: string | null; userId: string | null; userText: string | null; policyMode: "read-only" | "write" };
  order: FallbackCandidate[];
  attemptedModels: string[];
  limiter: CentralRateLimiter;
  primaryKey: string;
  primaryErrorMsg: string | null;
  failureList: { key: string; msg: string }[];
  lastError: unknown;
  lastFallbackReason: string | null;
}

/** Semua kandidat habis → checkpoint menunggu kuota (no crash, read-only). */
export function throwExhaustedCheckpoint(input: ExhaustedCheckpointInput): never {
  const { store, runContext, order, attemptedModels, limiter, primaryKey, primaryErrorMsg, failureList, lastError, lastFallbackReason } = input;
  // Semua kandidat habis → checkpoint menunggu kuota (no crash, read-only).
  const firstBlocked = (() => {
    for (const cand of order) {
      const b = limiter.isBlocked(candidateKey(cand), sharedKeyForCandidate(cand));
      if (b.blocked) return b;
    }
    return null;
  })();
  const primaryDetail = primaryErrorMsg ? `Model utama ${primaryKey}: ${primaryErrorMsg}` : "";
  const otherFailures = failureList.filter((f) => f.key !== primaryKey);
  let reason = primaryDetail;
  if (otherFailures.length > 0) {
    reason += `${reason ? " | " : ""}Cadangan: ${otherFailures.map((f) => `${f.key} (${f.msg})`).join("; ")}`;
  }
  if (!reason) {
    reason = lastError instanceof Error ? lastError.message : "Semua provider tidak tersedia.";
  }

  const cp = store.save({
    runId: runContext?.runId ?? null,
    conversationId: runContext?.conversationId ?? null,
    userId: runContext?.userId ?? null,
    userText: runContext?.userText ?? null,
    primaryModelKey: primaryKey,
    attemptedModels,
    reason: reason.slice(0, 1000),
    fallbackReason: lastFallbackReason,
    policyMode: "read-only",
    nextRetryAt: firstBlocked?.retryAt ?? null,
  });
  const waiting = new AppError(
    "UPSTREAM_ERROR",
    `Semua provider tidak tersedia; task disimpan sebagai checkpoint ${cp.id} dan menunggu kuota${firstBlocked?.retryAt ? ` (retry ${firstBlocked.retryAt})` : ""}. Tidak ada tool tulis yang dijalankan. Detail: ${reason.slice(0, 350)}`,
    502,
  );
  throw waiting;
}
