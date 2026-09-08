import type { ChatClient, StreamEvent } from "./chat-client";
import { AppError } from "../lib/errors";
import type { Logger } from "../lib/logger";
import {
  type CentralRateLimiter,
  type CheckpointStore,
  globalCheckpoints,
  globalRateLimiter,
} from "./rate-limiter";
import {
  candidateKey,
  describeStreamFailure,
  type FallbackCandidate,
  guessStatus,
  sharedKeyForCandidate,
} from "./model-fallback-candidates";
import { throwExhaustedCheckpoint } from "./model-fallback-exhausted";

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
      let primaryErrorMsg: string | null = null;
      const attempted: string[] = [];
      const failureList: { key: string; msg: string }[] = [];

      for (const cand of order) {
        const key = candidateKey(cand);
        attempted.push(key);
        const shared = sharedKeyForCandidate(cand);
        const blocked = limiter.isBlocked(key, shared);
        if (blocked.blocked) {
          const blockMsg = blocked.isDaily
            ? `Kuota harian ${key} habis; retry ${blocked.retryAt ?? "menunggu reset"}.`
            : `Rate limit ${key}; retry ${blocked.retryAt ?? "segera"}.`;
          lastError = new AppError("UPSTREAM_ERROR", blockMsg, 502);
          failureList.push({ key, msg: blockMsg });
          if (key === primaryKey && !primaryErrorMsg) primaryErrorMsg = blockMsg;
          continue;
        }
        let client: ChatClient;
        try {
          client = makeClientFor(cand);
        } catch (e) {
          lastError = e;
          const msg = e instanceof Error ? e.message : String(e);
          failureList.push({ key, msg });
          if (key === primaryKey && !primaryErrorMsg) primaryErrorMsg = msg;
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
          failureList.push({ key, msg });
          if (key === primaryKey && !primaryErrorMsg) primaryErrorMsg = msg;
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

      throwExhaustedCheckpoint({
        store,
        runContext: opts.runContext,
        order,
        attemptedModels: attempted,
        limiter,
        primaryKey,
        primaryErrorMsg,
        failureList,
        lastError,
        lastFallbackReason,
      });
    },
  };
}
