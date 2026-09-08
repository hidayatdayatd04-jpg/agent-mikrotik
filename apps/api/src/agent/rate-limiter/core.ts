import { acquireSlot, QueueTracker } from "./acquire";
import { BlockRegistry } from "./blocks";
import { BucketStore } from "./buckets";
import { clampPositiveInt } from "./estimate";
import { OverrideRegistry } from "./overrides";
import { snapshotModels, usageOf } from "./stats";
import {
  MAX_429_RETRIES_DEFAULT,
  MAX_QUEUE_DEFAULT,
  MAX_WAIT_MS_DEFAULT,
  type AcquireInput,
  type AcquireTicket,
  type EffectiveLimits,
  type LimiterOptions,
  type ModelRateSnapshot,
  type RateLimitOverride,
} from "./types";

export class CentralRateLimiter {
  private overrides: OverrideRegistry;
  private buckets = new BucketStore();
  private blocks: BlockRegistry;
  private queues: QueueTracker;
  private maxWaitMs: number;
  readonly maxRetries: number;
  private nowFn: () => number;
  private sleepFn: (ms: number) => Promise<void>;
  private jitterFn: () => number;

  constructor(opts: LimiterOptions = {}) {
    this.overrides = new OverrideRegistry(opts);
    this.maxWaitMs = clampPositiveInt(opts.maxWaitMs, MAX_WAIT_MS_DEFAULT);
    this.maxRetries = clampPositiveInt(opts.maxRetries, MAX_429_RETRIES_DEFAULT);
    this.nowFn = opts.nowFn ?? Date.now;
    this.sleepFn = opts.sleepFn ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.jitterFn = opts.jitterFn ?? (() => Math.random() * 1000);
    this.blocks = new BlockRegistry(this.nowFn, this.jitterFn);
    this.queues = new QueueTracker(clampPositiveInt(opts.maxQueueSize, MAX_QUEUE_DEFAULT));
  }

  now(): number {
    return this.nowFn();
  }

  private env() {
    return {
      now: this.nowFn,
      sleep: this.sleepFn,
      maxWaitMs: this.maxWaitMs,
      queues: this.queues,
      blocks: this.blocks,
      buckets: this.buckets,
      effectiveLimits: (input: { providerKind: string; modelKey: string; sharedKey?: string | null }) =>
        this.overrides.getEffectiveLimits(input),
    };
  }

  setProviderOverride(kind: string, override: RateLimitOverride): void {
    this.overrides.setProviderOverride(kind, override);
  }

  setModelOverride(modelKey: string, override: RateLimitOverride): void {
    this.overrides.setModelOverride(modelKey, override);
  }

  setSharedOverride(sharedKey: string, override: RateLimitOverride): void {
    this.overrides.setSharedOverride(sharedKey, override);
  }

  setRpdStatus(modelKey: string, rpd: { limit: number | null; remaining: number | null; resetAt: string | null }): void {
    this.blocks.setRpdStatus(modelKey, rpd);
  }

  getDefaults(): EffectiveLimits {
    return this.overrides.getDefaults();
  }

  setDefaults(override: RateLimitOverride): void {
    this.overrides.setDefaults(override);
  }

  getEffectiveLimits(input: { providerKind: string; modelKey: string; sharedKey?: string | null }): EffectiveLimits {
    return this.overrides.getEffectiveLimits(input);
  }

  /** Antre sampai kapasitas tersedia; lihat `acquireSlot`. */
  acquire(input: AcquireInput): Promise<AcquireTicket> {
    return acquireSlot(this.env(), input);
  }

  notifyRateLimited(input: { modelKey: string; sharedKey?: string | null; retryAtMs?: number | null; reason: string; blockShared?: boolean }): void {
    this.blocks.notifyRateLimited(input);
  }

  notifyDailyQuotaExhausted(input: { modelKey: string; sharedKey?: string | null; resetAtMs?: number | null; reason: string }): void {
    this.blocks.notifyDailyQuotaExhausted(input);
  }

  unblockModel(modelKey: string): void {
    this.blocks.unblockModel(modelKey);
  }

  clearExpiredBlocks(): void {
    this.blocks.clearExpiredBlocks();
  }

  notifySuccess(modelKey: string): void {
    this.blocks.notifySuccess(modelKey);
  }

  setFallbackReason(modelKey: string, reason: string): void {
    this.blocks.setFallbackReason(modelKey, reason);
  }

  getFallbackReason(modelKey: string): string | null {
    return this.blocks.getFallbackReason(modelKey);
  }

  isBlocked(modelKey: string, sharedKey?: string | null): { blocked: boolean; retryAt: string | null; reason: string | null; isDaily: boolean } {
    return this.blocks.blockState(modelKey, sharedKey);
  }

  usageOf(modelKey: string, sharedKey?: string | null): { rpmUsed: number; rpmLimit: number; tpmUsed: number; tpmLimit: number; nextRetryAt: string | null } {
    return usageOf(this.env(), modelKey, sharedKey);
  }

  snapshot(modelKeys?: string[]): ModelRateSnapshot[] {
    return snapshotModels(this.env(), modelKeys);
  }

  getGlobalQueue(): number {
    return this.queues.global;
  }

  reset(): void {
    this.buckets.reset();
    this.blocks.reset();
    this.queues.reset();
  }
}

/** Singleton proses untuk seluruh request (chat, retry, background task). */
export const globalRateLimiter = new CentralRateLimiter();
