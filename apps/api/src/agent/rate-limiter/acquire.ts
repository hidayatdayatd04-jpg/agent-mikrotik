import type { BlockRegistry } from "./blocks";
import type { BucketStore } from "./buckets";
import type { AcquireInput, AcquireTicket, EffectiveLimits } from "./types";

/** Queue FIFO global + per-model (#5). */
export class QueueTracker {
  private globalQueue = 0;
  private queueByModel = new Map<string, number>();

  constructor(private maxQueueSize: number) {}

  get global(): number {
    return this.globalQueue;
  }

  modelKeys(): Iterable<string> {
    return this.queueByModel.keys();
  }

  modelLength(modelKey: string): number {
    return this.queueByModel.get(modelKey) ?? 0;
  }

  /** Masuk antrean; lempar RATE_LIMITED bila penuh. Kembalikan fungsi release. */
  enter(modelKey: string): () => void {
    if (this.globalQueue >= this.maxQueueSize) {
      throw Object.assign(new Error(`Antrean rate limiter penuh (${this.globalQueue}). Coba lagi nanti.`), { code: "RATE_LIMITED" });
    }
    this.globalQueue += 1;
    this.queueByModel.set(modelKey, (this.queueByModel.get(modelKey) ?? 0) + 1);
    return () => {
      this.globalQueue = Math.max(0, this.globalQueue - 1);
      const q = (this.queueByModel.get(modelKey) ?? 1) - 1;
      if (q <= 0) this.queueByModel.delete(modelKey);
      else this.queueByModel.set(modelKey, q);
    };
  }

  reset(): void {
    this.queueByModel.clear();
    this.globalQueue = 0;
  }
}

export interface AcquireEnv {
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  maxWaitMs: number;
  queues: QueueTracker;
  blocks: BlockRegistry;
  buckets: BucketStore;
  effectiveLimits: (input: { providerKind: string; modelKey: string; sharedKey?: string | null }) => EffectiveLimits;
}

/**
 * Antre sampai kapasitas RPM+TPM tersedia pada bucket model DAN bucket shared
 * (bila ada). Mencatat reservasi estimasi token; panggil `complete(actual)`
 * setelah respons untuk rekonsiliasi.
 */
export async function acquireSlot(env: AcquireEnv, input: AcquireInput): Promise<AcquireTicket> {
  const started = env.now();
  const timeoutMs = input.timeoutMs ?? env.maxWaitMs;
  const modelBucket = `model:${input.modelKey}`;
  const sharedBucket = input.sharedKey ? `shared:${input.sharedKey}` : null;
  const limits = env.effectiveLimits({ providerKind: input.providerKind, modelKey: input.modelKey, sharedKey: input.sharedKey });

  const release = env.queues.enter(input.modelKey);
  try {
    for (;;) {
      if (input.signal?.aborted) {
        throw Object.assign(new Error("Permintaan dibatalkan saat menunggu rate limiter."), { code: "CANCELLED" });
      }
      const now = env.now();
      if (now - started > timeoutMs) {
        throw Object.assign(new Error(`Menunggu kapasitas rate limit ${input.modelKey} melebihi batas (${Math.round(timeoutMs / 1000)}s).`), { code: "RATE_LIMITED" });
      }
      // Blokir harian / Retry-After di level model maupun shared
      const modelBlocked = env.blocks.activeInfo(modelBucket, now);
      const sharedBlocked = sharedBucket ? env.blocks.activeInfo(sharedBucket, now) : null;
      const activeBlock = modelBlocked ?? sharedBlocked;
      if (activeBlock) {
        const waitMs = Math.max(0, activeBlock.until - now);
        if (now - started + waitMs > timeoutMs) {
          throw Object.assign(
            new Error(activeBlock.isDailyQuota ? `Kuota harian ${input.modelKey} habis. ${activeBlock.reason}` : `Model ${input.modelKey} dibatasi sementara. ${activeBlock.reason}`),
            { code: activeBlock.isDailyQuota ? "QUOTA_EXHAUSTED" : "RATE_LIMITED", retryAt: new Date(activeBlock.until).toISOString() },
          );
        }
        await env.sleep(Math.min(waitMs, 1000));
        continue;
      }

      const modelWait = env.buckets.waitForBucket(modelBucket, limits, input.estimatedTokens, now, env.blocks.activeUntil(modelBucket, now));
      let sharedWaitMs = 0;
      if (sharedBucket) {
        const sharedLimits = env.effectiveLimits({ providerKind: input.providerKind, modelKey: input.modelKey, sharedKey: input.sharedKey });
        sharedWaitMs = env.buckets.waitForBucket(sharedBucket, sharedLimits, input.estimatedTokens, now, env.blocks.activeUntil(sharedBucket, now)).waitMs;
      }
      const waitMs = Math.max(modelWait.waitMs, sharedWaitMs);
      if (waitMs <= 0) break;
      if (now - started + waitMs > timeoutMs) {
        throw Object.assign(new Error(`Kapasitas RPM/TPM ${input.modelKey} penuh; coba lagi dalam ${Math.ceil(waitMs / 1000)}s.`), { code: "RATE_LIMITED" });
      }
      // Tidur secukupnya (dibatasi 1 dtk per iterasi agar responsif terhadap abort).
      await env.sleep(Math.min(waitMs, 1000));
    }

    // Reservasi: catat 1 request + estimasi token pada tiap bucket terkait.
    const reservedAt = env.now();
    const keys = sharedBucket ? [modelBucket, sharedBucket] : [modelBucket];
    env.buckets.reserve(keys, reservedAt, input.estimatedTokens);

    let settled = false;
    const reconcile = (actualTokens: number | null) => {
      if (settled) return;
      settled = true;
      env.buckets.reconcile(keys, reservedAt, actualTokens);
    };

    return {
      waitedMs: env.now() - started,
      complete: (actualTokens: number) => reconcile(actualTokens),
      abandon: () => reconcile(null),
    };
  } finally {
    release();
  }
}
