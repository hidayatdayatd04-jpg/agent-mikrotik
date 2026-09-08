import type { QueueTracker } from "./acquire";
import type { BlockRegistry } from "./blocks";
import { sumTokens, type BucketStore } from "./buckets";
import type { EffectiveLimits, ModelRateSnapshot } from "./types";

export function providerKindOf(modelKey: string): string {
  const idx = modelKey.indexOf(":");
  return idx > 0 ? modelKey.slice(0, idx) : "custom";
}

export interface StatsEnv {
  now: () => number;
  buckets: BucketStore;
  blocks: BlockRegistry;
  queues: QueueTracker;
  effectiveLimits: (input: { providerKind: string; modelKey: string; sharedKey?: string | null }) => EffectiveLimits;
}

export function usageOf(
  env: StatsEnv,
  modelKey: string,
  sharedKey?: string | null,
): { rpmUsed: number; rpmLimit: number; tpmUsed: number; tpmLimit: number; nextRetryAt: string | null } {
  const now = env.now();
  const limits = env.effectiveLimits({ providerKind: providerKindOf(modelKey), modelKey, sharedKey });
  const bucket = env.buckets.bucketFor(`model:${modelKey}`);
  env.buckets.prune(bucket, now);
  const blocked = env.blocks.blockState(modelKey, sharedKey);
  return {
    rpmUsed: bucket.requests.length,
    rpmLimit: limits.rpm,
    tpmUsed: sumTokens(bucket),
    tpmLimit: limits.tpm,
    nextRetryAt: blocked.retryAt,
  };
}

export function snapshotModels(env: StatsEnv, modelKeys?: string[]): ModelRateSnapshot[] {
  const now = env.now();
  const keys = modelKeys ?? [
    ...new Set([
      ...[...env.buckets.keys()].filter((k) => k.startsWith("model:")).map((k) => k.slice("model:".length)),
      ...env.blocks.blockedModelKeys(),
      ...[...env.queues.modelKeys()],
      ...[...env.blocks.fallbackKeys()],
    ]),
  ];
  return keys.map((modelKey) => {
    const bucket = env.buckets.bucketFor(`model:${modelKey}`);
    env.buckets.prune(bucket, now);
    const blocked = env.blocks.activeInfo(`model:${modelKey}`, now);
    // Efektif tanpa sharedKey (UI global); per-request shared tetap ditegakkan di acquire().
    const limits = env.effectiveLimits({ providerKind: providerKindOf(modelKey), modelKey });
    return {
      modelKey,
      providerKind: providerKindOf(modelKey),
      rpmUsed: bucket.requests.length,
      rpmLimit: limits.rpm,
      tpmUsed: sumTokens(bucket),
      tpmLimit: limits.tpm,
      rpdStatus: env.blocks.rpdOf(modelKey),
      queueLength: env.queues.modelLength(modelKey),
      nextRetryAt: blocked ? new Date(blocked.until).toISOString() : null,
      blockedReason: blocked?.reason ?? null,
      fallbackReason: env.blocks.fallbackReasonOf(modelKey),
      isDailyQuotaExhausted: blocked?.isDailyQuota ?? false,
    };
  });
}
