import { computeBackoffWithJitter, nextMidnightUtcMs } from "./estimate";
import type { BlockInfo } from "./types";

export type RpdStatus = { limit: number | null; remaining: number | null; resetAt: string | null };

/** Blokir sementara (429/Retry-After/kuota harian) + alasan fallback + status RPD. */
export class BlockRegistry {
  private blocked = new Map<string, BlockInfo>();
  private fallbackReasons = new Map<string, string>();
  private rpdByModel = new Map<string, RpdStatus>();

  constructor(
    private now: () => number,
    private jitter: () => number,
  ) {}

  private infoIfActive(key: string, now: number): BlockInfo | null {
    const b = this.blocked.get(key);
    if (!b) return null;
    if (b.until <= now) {
      this.blocked.delete(key);
      return null;
    }
    return b;
  }

  activeInfo(key: string, now: number): BlockInfo | null {
    return this.infoIfActive(key, now);
  }

  activeUntil(key: string, now: number): number | null {
    return this.infoIfActive(key, now)?.until ?? null;
  }

  /** Catat 429 / Retry-After dari provider; hormati Retry-After apa adanya. */
  notifyRateLimited(input: { modelKey: string; sharedKey?: string | null; retryAtMs?: number | null; reason: string; blockShared?: boolean }): void {
    const now = this.now();
    const until = input.retryAtMs && Number.isFinite(input.retryAtMs) && input.retryAtMs > now
      ? input.retryAtMs
      : now + computeBackoffWithJitter(0, 1000, 30_000, this.jitter());
    const info: BlockInfo = { until, reason: input.reason, isDailyQuota: false };
    this.blocked.set(`model:${input.modelKey}`, info);
    // Hanya blokir sharedKey jika secara eksplisit diminta (mis. kuota project/akun),
    // jangan blokir model-model alternatif pada provider yang sama saat terjadi 429 per-model.
    if (input.sharedKey && input.blockShared) {
      const sharedInfo: BlockInfo = { until, reason: `Shared quota: ${input.reason}`, isDailyQuota: false };
      const existing = this.blocked.get(`shared:${input.sharedKey}`);
      if (!existing || existing.until < until) this.blocked.set(`shared:${input.sharedKey}`, sharedInfo);
    }
  }

  /** Hentikan sementara model yang kuota hariannya habis (tanpa RPD buatan aplikasi). */
  notifyDailyQuotaExhausted(input: { modelKey: string; sharedKey?: string | null; resetAtMs?: number | null; reason: string }): void {
    const now = this.now();
    const until = input.resetAtMs && Number.isFinite(input.resetAtMs) && input.resetAtMs > now
      ? input.resetAtMs
      : nextMidnightUtcMs(now);
    this.blocked.set(`model:${input.modelKey}`, { until, reason: input.reason, isDailyQuota: true });
    if (input.sharedKey) {
      this.blocked.set(`shared:${input.sharedKey}`, { until, reason: `Shared daily quota: ${input.reason}`, isDailyQuota: true });
    }
    this.fallbackReasons.set(input.modelKey, `Kuota harian habis: ${input.reason}`);
  }

  unblockModel(modelKey: string): void {
    this.blocked.delete(`model:${modelKey}`);
    this.fallbackReasons.delete(modelKey);
  }

  clearExpiredBlocks(): void {
    const now = this.now();
    for (const [k, info] of this.blocked.entries()) {
      if (info.until <= now) this.blocked.delete(k);
    }
  }

  notifySuccess(modelKey: string): void {
    // Sukses menghapus penanda fallback sementara (bukan RPD/history).
    if (this.fallbackReasons.get(modelKey)?.startsWith("Rate limit sementara")) {
      this.fallbackReasons.delete(modelKey);
    }
  }

  setFallbackReason(modelKey: string, reason: string): void {
    this.fallbackReasons.set(modelKey, reason);
  }

  getFallbackReason(modelKey: string): string | null {
    return this.fallbackReasons.get(modelKey) ?? null;
  }

  setRpdStatus(modelKey: string, rpd: RpdStatus): void {
    this.rpdByModel.set(modelKey, rpd);
  }

  rpdOf(modelKey: string): RpdStatus | null {
    return this.rpdByModel.get(modelKey) ?? null;
  }

  blockState(modelKey: string, sharedKey?: string | null): { blocked: boolean; retryAt: string | null; reason: string | null; isDaily: boolean } {
    const now = this.now();
    const modelBlocked = this.infoIfActive(`model:${modelKey}`, now);
    const sharedBlocked = sharedKey ? this.infoIfActive(`shared:${sharedKey}`, now) : null;
    const active = modelBlocked ?? sharedBlocked;
    if (!active) return { blocked: false, retryAt: null, reason: null, isDaily: false };
    return { blocked: true, retryAt: new Date(active.until).toISOString(), reason: active.reason, isDaily: active.isDailyQuota };
  }

  blockedModelKeys(): string[] {
    return [...this.blocked.keys()].filter((k) => k.startsWith("model:")).map((k) => k.slice("model:".length));
  }

  fallbackKeys(): Iterable<string> {
    return this.fallbackReasons.keys();
  }

  fallbackReasonOf(modelKey: string): string | null {
    return this.fallbackReasons.get(modelKey) ?? null;
  }

  reset(): void {
    this.blocked.clear();
    this.fallbackReasons.clear();
    this.rpdByModel.clear();
  }
}
