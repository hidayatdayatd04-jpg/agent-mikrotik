import type { ChatClient, StreamEvent } from "./chat-client";
import { AppError } from "../lib/errors";
import type { Logger } from "../lib/logger";
import {
  CentralRateLimiter,
  CheckpointStore,
  classifyQuotaError,
  globalCheckpoints,
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

/** Klasifikasi error stream untuk keputusan retry vs fallback vs checkpoint. */
export function describeStreamFailure(status: number, message: string): {
  kind: "daily_quota" | "rate_limit" | "other";
  shouldFallback: boolean;
} {
  if (isDailyQuotaError(status, message)) return { kind: "daily_quota", shouldFallback: true };
  const c = classifyQuotaError(status, message);
  if (c.kind === "rate_limit" || status === 429) return { kind: "rate_limit", shouldFallback: true };
  return { kind: "other", shouldFallback: false };
}

export interface FallbackChatClientOptions {
  limiter?: CentralRateLimiter;
  checkpoints?: CheckpointStore;
  logger?: Logger;
  runContext?: { runId: string | null; conversationId: string | null; userId: string | null; userText: string | null; policyMode: "read-only" | "write" };
}

/**
 * ChatClient yang tahan rate-limit: mencoba primer, lalu fallback cadangan yang
 * kompatibel untuk SETIAP pemanggilan stream (setiap turn tool-calling).
 * Tidak pernah mengubah mode policy; hanya mengganti model penyedia.
 */
export function createFallbackChatClient(
  primary: FallbackCandidate,
  candidates: FallbackCandidate[],
  makeClientFor: (c: FallbackCandidate) => ChatClient,
  opts: FallbackChatClientOptions = {},
): ChatClient & { getActiveModelKey: () => string; getFallbackReason: () => string | null } {
  const limiter = opts.limiter ?? globalRateLimiter;
  const store = opts.checkpoints ?? globalCheckpoints;
  const primaryKey = candidateKey(primary);
  let activeKey = primaryKey;
  let lastFallbackReason: string | null = null;

  // Urutan coba: primer dulu, lalu cadangan yang enabled & tidak diblokir.
  function orderedCandidates(): FallbackCandidate[] {
    const seen = new Set<string>();
    const out: FallbackCandidate[] = [];
    const push = (c: FallbackCandidate) => {
      const k = candidateKey(c);
      if (seen.has(k)) return;
      seen.add(k);
      out.push(c);
    };
    push(primary);
    for (const c of candidates) {
      if (!c.enabled) continue;
      if (candidateKey(c) === primaryKey) continue;
      push(c);
    }
    return out;
  }

  return {
    modelLabel: `${primary.providerKind}:${primary.model}`,
    getActiveModelKey: () => activeKey,
    getFallbackReason: () => lastFallbackReason,
    async *stream(input): AsyncGenerator<StreamEvent> {
      const order = orderedCandidates();
      let lastError: unknown = null;
      const attempted: string[] = [];

      for (const cand of order) {
        const key = candidateKey(cand);
        attempted.push(key);
        const shared = sharedKeyForCandidate(cand);
        const blocked = limiter.isBlocked(key, shared);
        if (blocked.blocked) {
          lastError = new AppError(
            "UPSTREAM_ERROR",
            blocked.isDaily
              ? `Kuota harian ${key} habis; retry ${blocked.retryAt ?? "menunggu reset"}.`
              : `Rate limit ${key}; retry ${blocked.retryAt ?? "segera"}.`,
            502,
          );
          continue;
        }
        let client: ChatClient;
        try {
          client = makeClientFor(cand);
        } catch (e) {
          lastError = e;
          continue;
        }
        try {
          let sawUsage = false;
          for await (const ev of client.stream(input)) {
            if (ev.type === "usage") sawUsage = true;
            void sawUsage;
            yield ev;
          }
          // Sukses: catat model aktif + alasan fallback (bila pindah model).
          activeKey = key;
          if (key !== primaryKey) {
            lastFallbackReason = `Fallback ${primaryKey} → ${key}: primer tidak tersedia saat request.`;
            limiter.setFallbackReason(primaryKey, lastFallbackReason);
          } else if (lastFallbackReason === null) {
            // tetap primer, tidak ada fallback
          }
          (this as { modelLabel?: string }).modelLabel = `${cand.providerKind}:${cand.model}`;
          return;
        } catch (err) {
          lastError = err;
          const msg = err instanceof Error ? err.message : String(err);
          const status = err instanceof AppError ? err.status : 0;
          const desc = describeStreamFailure(status === 502 || status === 0 ? guessStatus(msg) : status, msg);
          if (!desc.shouldFallback) throw err;
          // Tandai primer agar UI menampilkan alasan fallback.
          const fbReason = `Fallback dicoba: ${key} gagal (${desc.kind}); lanjut ke cadangan berikutnya.`;
          limiter.setFallbackReason(primaryKey, fbReason);
          lastFallbackReason = fbReason;
          opts.logger?.warn?.("fallback to next model", { failedModel: key, kind: desc.kind });
          continue;
        }
      }

      // Semua kandidat habis → checkpoint menunggu kuota (no crash, read-only).
      const firstBlocked = (() => {
        for (const cand of order) {
          const b = limiter.isBlocked(candidateKey(cand), sharedKeyForCandidate(cand));
          if (b.blocked) return b;
        }
        return null;
      })();
      const reason = lastError instanceof Error ? lastError.message : "Semua provider tidak tersedia.";
      const cp = store.save({
        runId: opts.runContext?.runId ?? null,
        conversationId: opts.runContext?.conversationId ?? null,
        userId: opts.runContext?.userId ?? null,
        userText: opts.runContext?.userText ?? null,
        primaryModelKey: primaryKey,
        attemptedModels: attempted,
        reason: reason.slice(0, 1000),
        fallbackReason: lastFallbackReason,
        policyMode: "read-only",
        nextRetryAt: firstBlocked?.retryAt ?? null,
      });
      const waiting = new AppError(
        "UPSTREAM_ERROR",
        `Semua provider tidak tersedia; task disimpan sebagai checkpoint ${cp.id} dan menunggu kuota${firstBlocked?.retryAt ? ` (retry ${firstBlocked.retryAt})` : ""}. Tidak ada tool tulis yang dijalankan. Detail: ${reason.slice(0, 300)}`,
        502,
      );
      throw waiting;
    },
  };
}

function guessStatus(message: string): number {
  if (/429|rate limit|kuota/i.test(message)) return 429;
  if (/kuota harian|daily|RPD/i.test(message)) return 429;
  return 0;
}
