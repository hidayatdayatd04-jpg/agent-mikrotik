/**
 * Centralized AI rate limiter for all providers/models (Gemini, OpenRouter, custom).
 *
 * Kebijakan default global (aturan implementasi #1):
 *   - 4 RPM (request per menit) per model
 *   - 150.000 TPM (token per menit) per model
 *   - RPD tidak dibatasi secara lokal; ikuti kuota harian resmi provider (#2).
 *
 * Semua request (chat, tool calling, retry, background task seperti compaction)
 * wajib melewati limiter ini sebelum menyentuh provider.
 *
 * Algoritma: rolling/sliding window 60 detik yang akurat (#3):
 *   - RPM: timestamps request dalam 60 dtk terakhir
 *   - TPM: { ts, tokens } dalam 60 dtk terakhir (estimasi sebelum request,
 *     direkonsiliasi dengan token aktual dari respons API)
 *
 * Fitur:
 *   - Override per-provider / per-model yang lebih ketat (#4). Efektif =
 *     min(global, provider, model, shared). Global tidak pernah mengabaikan
 *     limit provider yang lebih rendah.
 *   - Shared quota level project/API-key (#4): bila beberapa model berbagi
 *     `sharedKey` (fingerprint API key), seluruh pemakaian dijumlahkan pada
 *     bucket bersama.
 *   - Queue FIFO + Retry-After + exponential backoff dengan jitter (#5).
 *   - Klasifikasi 429 vs kuota harian habis; model yang kehabisan kuota harian
 *     dihentikan sementara sampai kuota tersedia / fallback (#2, #6).
 *   - Statistik untuk UI (#7): pemakaian RPM/TPM lokal (diberi label estimasi),
 *     status RPD hanya bila provider menyediakannya, queue, retry berikutnya,
 *     alasan fallback. Estimasi lokal TIDAK PERNAH diklaim sebagai kuota resmi.
 *   - Read-only guarantee (#8): modul ini tidak menyentuh policy mode/tools.
 */

import { createHash } from "node:crypto";

export const DEFAULT_GLOBAL_RPM = 4;
export const DEFAULT_GLOBAL_TPM = 150_000;
export const RATE_WINDOW_MS = 60_000;
export const MAX_QUEUE_DEFAULT = 50;
export const MAX_WAIT_MS_DEFAULT = 5 * 60_000;
export const MAX_429_RETRIES_DEFAULT = 3;

export type ProviderKindLabel = "gemini" | "openrouter" | "custom" | string;

export interface RateLimitOverride {
  rpm?: number;
  tpm?: number;
}

export interface EffectiveLimits {
  rpm: number;
  tpm: number;
}

export interface LimiterOptions {
  defaults?: RateLimitOverride;
  providerOverrides?: Record<string, RateLimitOverride>;
  modelOverrides?: Record<string, RateLimitOverride>;
  sharedOverrides?: Record<string, RateLimitOverride>;
  maxQueueSize?: number;
  maxWaitMs?: number;
  maxRetries?: number;
  nowFn?: () => number;
  sleepFn?: (ms: number) => Promise<void>;
  jitterFn?: () => number;
}

export interface AcquireInput {
  /** Kunci unik model, mis. "gemini:gemini-2.0-flash" atau "custom:my-model". */
  modelKey: string;
  providerKind: ProviderKindLabel;
  /** Bucket bersama (fingerprint API key / project). Opsional. */
  sharedKey?: string | null;
  estimatedTokens: number;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface AcquireTicket {
  /** Panggil setelah respons dengan token aktual (prompt+completion). */
  complete: (actualTokens: number) => void;
  /** Panggil bila request gagal sebelum usage diketahui (tetap hitung RPM). */
  abandon: () => void;
  waitedMs: number;
}

export interface BlockInfo {
  until: number;
  reason: string;
  isDailyQuota: boolean;
}

export interface ModelRateSnapshot {
  modelKey: string;
  providerKind: string;
  /** Estimasi lokal rolling 60 dtk — BUKAN kuota resmi provider. */
  rpmUsed: number;
  rpmLimit: number;
  tpmUsed: number;
  tpmLimit: number;
  /** Status RPD hanya bila provider menyediakannya via header/observasi. */
  rpdStatus: { limit: number | null; remaining: number | null; resetAt: string | null } | null;
  queueLength: number;
  nextRetryAt: string | null;
  blockedReason: string | null;
  fallbackReason: string | null;
  isDailyQuotaExhausted: boolean;
}

function clampPositiveInt(v: unknown, fallback: number): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

function minPositive(...values: (number | undefined | null)[]): number {
  let out: number | null = null;
  for (const v of values) {
    if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) continue;
    out = out === null ? v : Math.min(out, v);
  }
  return out ?? Number.POSITIVE_INFINITY;
}

/** Fingerprint aman untuk API key agar model berbagi key memakai bucket bersama. */
export function sharedKeyForApiKey(apiKey: string): string {
  return `key:${createHash("sha256").update(apiKey).digest("hex").slice(0, 16)}`;
}

export function modelKeyFor(providerKind: string, model: string): string {
  return `${providerKind}:${model}`;
}

/** Estimasi token konservatif: ~3.5 char per token (ID/EN + output RouterOS). */
export function estimateTokensFromChars(chars: number): number {
  return Math.max(1, Math.ceil(chars / 3.5));
}

/**
 * Estimasi total token (input + output reserve) sebelum request.
 * Dipakai untuk pre-check TPM; direkonsiliasi dengan token aktual setelahnya.
 */
export function estimateRequestTokens(input: {
  messages: { content: string | null }[];
  tools?: unknown;
  maxTokens: number;
}): number {
  let chars = 0;
  for (const m of input.messages) chars += (m.content ?? "").length;
  if (input.tools !== undefined) {
    try {
      chars += JSON.stringify(input.tools).length;
    } catch {
      chars += 2000;
    }
  }
  // overhead framing untuk role/tool-call JSON
  chars += input.messages.length * 24;
  const inputEst = estimateTokensFromChars(chars);
  const outputReserve = clampPositiveInt(input.maxTokens, 1);
  return inputEst + outputReserve;
}

/** Backoff eksponensial dengan jitter: base * 2^attempt + jitter(0..1s). */
export function computeBackoffWithJitter(attempt: number, baseMs = 1000, capMs = 60_000, jitterMs = Math.random() * 1000): number {
  const exp = baseMs * 2 ** Math.max(0, attempt);
  return Math.min(capMs, exp + Math.max(0, jitterMs));
}

/** Parse Retry-After: detik / "12s" / HTTP-date / ms number. */
export function parseRetryAfterMs(raw: string | null | undefined, now: number): number | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  if (!s) return null;
  // "12s" / "11.4s"
  const secMatch = s.match(/^([\d.]+)\s*s$/i);
  if (secMatch) {
    const sec = Number(secMatch[1]);
    if (Number.isFinite(sec) && sec >= 0) return Math.min(sec * 1000, 24 * 3600_000);
  }
  // detik murni
  if (/^[\d.]+$/.test(s)) {
    const sec = Number(s);
    if (Number.isFinite(sec) && sec >= 0) return Math.min(sec * 1000, 24 * 3600_000);
  }
  // HTTP date
  const parsed = Date.parse(s);
  if (Number.isFinite(parsed)) return Math.max(0, parsed - now);
  return null;
}

const DAILY_PATTERNS =
  /daily|per[ _-]?day|\bRPD\b|per[ _-]?24h|24\s*hours?|GenerateRequestsPerDay|requests[ _-]?per[ _-]?day|day[ _-]?quota|quota[ _-]?per[ _-]?day|daily[ _-]?limit|quota.*(day|daily)|(day|daily).*quota/i;

export type QuotaKind = "daily_quota" | "rate_limit" | "other";

export function classifyQuotaError(status: number, message: string): { kind: QuotaKind; isDaily: boolean } {
  const msg = message ?? "";
  if (status === 429 || status === 403) {
    if (DAILY_PATTERNS.test(msg)) return { kind: "daily_quota", isDaily: true };
    // Frasa kuota generik tanpa kata "daily" tetap dianggap rate limit biasa
    // kecuali ada penanda harian yang jelas — agar tidak salah memblokir 24 jam.
    return { kind: status === 429 ? "rate_limit" : "other", isDaily: false };
  }
  if (/quota exceeded|resource_exhausted|rate limit exceeded/i.test(msg) && DAILY_PATTERNS.test(msg)) {
    return { kind: "daily_quota", isDaily: true };
  }
  return { kind: "other", isDaily: false };
}

/** Tengah malam UTC berikutnya — reset alami untuk kuota harian bila provider tak memberi waktu. */
export function nextMidnightUtcMs(now: number): number {
  const d = new Date(now);
  d.setUTCHours(24, 0, 0, 0);
  return d.getTime();
}

interface Bucket {
  requests: number[];
  tokens: { ts: number; tokens: number }[];
}

export class CentralRateLimiter {
  private defaults: Required<RateLimitOverride>;
  private providerOverrides = new Map<string, RateLimitOverride>();
  private modelOverrides = new Map<string, RateLimitOverride>();
  private sharedOverrides = new Map<string, RateLimitOverride>();
  private buckets = new Map<string, Bucket>();
  private blocked = new Map<string, BlockInfo>();
  private fallbackReasons = new Map<string, string>();
  private rpdByModel = new Map<string, { limit: number | null; remaining: number | null; resetAt: string | null }>();
  private queueByModel = new Map<string, number>();
  private globalQueue = 0;
  private maxQueueSize: number;
  private maxWaitMs: number;
  readonly maxRetries: number;
  private nowFn: () => number;
  private sleepFn: (ms: number) => Promise<void>;
  private jitterFn: () => number;

  constructor(opts: LimiterOptions = {}) {
    this.defaults = {
      rpm: clampPositiveInt(opts.defaults?.rpm, DEFAULT_GLOBAL_RPM),
      tpm: clampPositiveInt(opts.defaults?.tpm, DEFAULT_GLOBAL_TPM),
    };
    for (const [k, v] of Object.entries(opts.providerOverrides ?? {})) this.providerOverrides.set(k, { ...v });
    for (const [k, v] of Object.entries(opts.modelOverrides ?? {})) this.modelOverrides.set(k, { ...v });
    for (const [k, v] of Object.entries(opts.sharedOverrides ?? {})) this.sharedOverrides.set(k, { ...v });
    this.maxQueueSize = clampPositiveInt(opts.maxQueueSize, MAX_QUEUE_DEFAULT);
    this.maxWaitMs = clampPositiveInt(opts.maxWaitMs, MAX_WAIT_MS_DEFAULT);
    this.maxRetries = clampPositiveInt(opts.maxRetries, MAX_429_RETRIES_DEFAULT);
    this.nowFn = opts.nowFn ?? Date.now;
    this.sleepFn = opts.sleepFn ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.jitterFn = opts.jitterFn ?? (() => Math.random() * 1000);
  }

  now(): number {
    return this.nowFn();
  }

  setProviderOverride(kind: string, override: RateLimitOverride): void {
    this.providerOverrides.set(kind, { ...override });
  }

  setModelOverride(modelKey: string, override: RateLimitOverride): void {
    this.modelOverrides.set(modelKey, { ...override });
  }

  setSharedOverride(sharedKey: string, override: RateLimitOverride): void {
    this.sharedOverrides.set(sharedKey, { ...override });
  }

  setRpdStatus(modelKey: string, rpd: { limit: number | null; remaining: number | null; resetAt: string | null }): void {
    this.rpdByModel.set(modelKey, rpd);
  }

  getDefaults(): EffectiveLimits {
    return { ...this.defaults };
  }

  setDefaults(override: RateLimitOverride): void {
    if (override.rpm !== undefined) this.defaults.rpm = clampPositiveInt(override.rpm, this.defaults.rpm);
    if (override.tpm !== undefined) this.defaults.tpm = clampPositiveInt(override.tpm, this.defaults.tpm);
  }

  getEffectiveLimits(input: { providerKind: string; modelKey: string; sharedKey?: string | null }): EffectiveLimits {
    const provider = this.providerOverrides.get(input.providerKind);
    const model = this.modelOverrides.get(input.modelKey);
    const shared = input.sharedKey ? this.sharedOverrides.get(input.sharedKey) : undefined;
    const rpm = minPositive(this.defaults.rpm, provider?.rpm, model?.rpm, shared?.rpm);
    const tpm = minPositive(this.defaults.tpm, provider?.tpm, model?.tpm, shared?.tpm);
    return {
      rpm: Number.isFinite(rpm) ? Math.floor(rpm) : this.defaults.rpm,
      tpm: Number.isFinite(tpm) ? Math.floor(tpm) : this.defaults.tpm,
    };
  }

  private bucketFor(key: string): Bucket {
    let b = this.buckets.get(key);
    if (!b) {
      b = { requests: [], tokens: [] };
      this.buckets.set(key, b);
    }
    return b;
  }

  private prune(bucket: Bucket, now: number): void {
    const cutoff = now - RATE_WINDOW_MS;
    while (bucket.requests.length > 0 && bucket.requests[0]! <= cutoff) bucket.requests.shift();
    while (bucket.tokens.length > 0 && bucket.tokens[0]!.ts <= cutoff) bucket.tokens.shift();
  }

  private blockInfoIfActive(key: string, now: number): BlockInfo | null {
    const b = this.blocked.get(key);
    if (!b) return null;
    if (b.until <= now) {
      this.blocked.delete(key);
      return null;
    }
    return b;
  }

  /** Waktu tunggu (ms) sampai `estimatedTokens` muat pada satu bucket. 0 = muat. */
  private waitForBucket(bucketKey: string, limit: EffectiveLimits, estimatedTokens: number, now: number): { waitMs: number; rpmUsed: number; tpmUsed: number } {
    const bucket = this.bucketFor(bucketKey);
    this.prune(bucket, now);
    const blocked = this.blockInfoIfActive(bucketKey, now);
    if (blocked) return { waitMs: Math.max(0, blocked.until - now), rpmUsed: bucket.requests.length, tpmUsed: sumTokens(bucket) };

    // Bila satu request saja sudah melebihi TPM, tetap antre sampai jendela kosong total.
    if (estimatedTokens > limit.tpm) {
      if (bucket.tokens.length === 0 && bucket.requests.length === 0) return { waitMs: 0, rpmUsed: 0, tpmUsed: 0 };
      const oldestToken = bucket.tokens[0]?.ts ?? bucket.requests[0] ?? now;
      const oldestReq = bucket.requests[0] ?? oldestToken;
      return { waitMs: Math.max(0, Math.min(oldestToken, oldestReq) + RATE_WINDOW_MS - now), rpmUsed: bucket.requests.length, tpmUsed: sumTokens(bucket) };
    }

    if (bucket.requests.length >= limit.rpm) {
      const oldest = bucket.requests[0] ?? now;
      return { waitMs: Math.max(0, oldest + RATE_WINDOW_MS - now), rpmUsed: bucket.requests.length, tpmUsed: sumTokens(bucket) };
    }
    const used = sumTokens(bucket);
    if (used + estimatedTokens > limit.tpm) {
      // Tunggu entry token tertua kedaluwarsa, lalu cek ulang (loop di acquire).
      const oldest = bucket.tokens[0]?.ts ?? bucket.requests[0] ?? now;
      return { waitMs: Math.max(0, oldest + RATE_WINDOW_MS - now), rpmUsed: bucket.requests.length, tpmUsed: used };
    }
    return { waitMs: 0, rpmUsed: bucket.requests.length, tpmUsed: used };
  }

  /**
   * Antre sampai kapasitas RPM+TPM tersedia pada bucket model DAN bucket shared
   * (bila ada). Mencatat reservasi estimasi token; panggil `complete(actual)`
   * setelah respons untuk rekonsiliasi.
   */
  async acquire(input: AcquireInput): Promise<AcquireTicket> {
    const started = this.now();
    const timeoutMs = input.timeoutMs ?? this.maxWaitMs;
    const modelBucket = `model:${input.modelKey}`;
    const sharedBucket = input.sharedKey ? `shared:${input.sharedKey}` : null;
    const limits = this.getEffectiveLimits({ providerKind: input.providerKind, modelKey: input.modelKey, sharedKey: input.sharedKey });

    if (this.globalQueue >= this.maxQueueSize) {
      throw Object.assign(new Error(`Antrean rate limiter penuh (${this.globalQueue}). Coba lagi nanti.`), { code: "RATE_LIMITED" });
    }
    this.globalQueue += 1;
    this.queueByModel.set(input.modelKey, (this.queueByModel.get(input.modelKey) ?? 0) + 1);
    try {
      for (;;) {
        if (input.signal?.aborted) {
          throw Object.assign(new Error("Permintaan dibatalkan saat menunggu rate limiter."), { code: "CANCELLED" });
        }
        const now = this.now();
        if (now - started > timeoutMs) {
          throw Object.assign(new Error(`Menunggu kapasitas rate limit ${input.modelKey} melebihi batas (${Math.round(timeoutMs / 1000)}s).`), { code: "RATE_LIMITED" });
        }
        // Blokir harian / Retry-After di level model maupun shared
        const modelBlocked = this.blockInfoIfActive(modelBucket, now);
        const sharedBlocked = sharedBucket ? this.blockInfoIfActive(sharedBucket, now) : null;
        const activeBlock = modelBlocked ?? sharedBlocked;
        if (activeBlock) {
          const waitMs = Math.max(0, activeBlock.until - now);
          if (now - started + waitMs > timeoutMs) {
            throw Object.assign(
              new Error(activeBlock.isDailyQuota ? `Kuota harian ${input.modelKey} habis. ${activeBlock.reason}` : `Model ${input.modelKey} dibatasi sementara. ${activeBlock.reason}`),
              { code: activeBlock.isDailyQuota ? "QUOTA_EXHAUSTED" : "RATE_LIMITED", retryAt: new Date(activeBlock.until).toISOString() },
            );
          }
          await this.sleepFn(Math.min(waitMs, 1000));
          continue;
        }

        const modelWait = this.waitForBucket(modelBucket, limits, input.estimatedTokens, now);
        let sharedWaitMs = 0;
        if (sharedBucket) {
          const sharedLimits = this.getEffectiveLimits({ providerKind: input.providerKind, modelKey: input.modelKey, sharedKey: input.sharedKey });
          sharedWaitMs = this.waitForBucket(sharedBucket, sharedLimits, input.estimatedTokens, now).waitMs;
        }
        const waitMs = Math.max(modelWait.waitMs, sharedWaitMs);
        if (waitMs <= 0) break;
        if (now - started + waitMs > timeoutMs) {
          throw Object.assign(new Error(`Kapasitas RPM/TPM ${input.modelKey} penuh; coba lagi dalam ${Math.ceil(waitMs / 1000)}s.`), { code: "RATE_LIMITED" });
        }
        // Tidur secukupnya (dibatasi 1 dtk per iterasi agar responsif terhadap abort).
        await this.sleepFn(Math.min(waitMs, 1000));
      }

      // Reservasi: catat 1 request + estimasi token pada tiap bucket terkait.
      const reservedAt = this.now();
      const reserve = (bucketKey: string) => {
        const b = this.bucketFor(bucketKey);
        this.prune(b, reservedAt);
        b.requests.push(reservedAt);
        b.tokens.push({ ts: reservedAt, tokens: Math.max(1, Math.floor(input.estimatedTokens)) });
      };
      reserve(modelBucket);
      if (sharedBucket) reserve(sharedBucket);

      let settled = false;
      const reconcile = (actualTokens: number | null) => {
        if (settled) return;
        settled = true;
        if (actualTokens === null || !Number.isFinite(actualTokens)) return;
        const actual = Math.max(1, Math.floor(actualTokens));
        const fix = (bucketKey: string) => {
          const b = this.buckets.get(bucketKey);
          if (!b || b.tokens.length === 0) return;
          // Koreksi entry reservasi terakhir agar total jendela = aktual, bukan estimasi+ganda.
          for (let i = b.tokens.length - 1; i >= 0; i--) {
            if (b.tokens[i]!.ts === reservedAt) {
              b.tokens[i] = { ts: reservedAt, tokens: actual };
              break;
            }
          }
        };
        fix(modelBucket);
        if (sharedBucket) fix(sharedBucket);
      };

      return {
        waitedMs: this.now() - started,
        complete: (actualTokens: number) => reconcile(actualTokens),
        abandon: () => reconcile(null),
      };
    } finally {
      this.globalQueue = Math.max(0, this.globalQueue - 1);
      const q = (this.queueByModel.get(input.modelKey) ?? 1) - 1;
      if (q <= 0) this.queueByModel.delete(input.modelKey);
      else this.queueByModel.set(input.modelKey, q);
    }
  }

  /** Catat 429 / Retry-After dari provider; hormati Retry-After apa adanya. */
  notifyRateLimited(input: { modelKey: string; sharedKey?: string | null; retryAtMs?: number | null; reason: string; blockShared?: boolean }): void {
    const now = this.now();
    const until = input.retryAtMs && Number.isFinite(input.retryAtMs) && input.retryAtMs > now
      ? input.retryAtMs
      : now + computeBackoffWithJitter(0, 1000, 30_000, this.jitterFn());
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

  isBlocked(modelKey: string, sharedKey?: string | null): { blocked: boolean; retryAt: string | null; reason: string | null; isDaily: boolean } {
    const now = this.now();
    const modelBlocked = this.blockInfoIfActive(`model:${modelKey}`, now);
    const sharedBlocked = sharedKey ? this.blockInfoIfActive(`shared:${sharedKey}`, now) : null;
    const active = modelBlocked ?? sharedBlocked;
    if (!active) return { blocked: false, retryAt: null, reason: null, isDaily: false };
    return { blocked: true, retryAt: new Date(active.until).toISOString(), reason: active.reason, isDaily: active.isDailyQuota };
  }

  usageOf(modelKey: string, sharedKey?: string | null): { rpmUsed: number; rpmLimit: number; tpmUsed: number; tpmLimit: number; nextRetryAt: string | null } {
    const now = this.now();
    const limits = this.getEffectiveLimits({ providerKind: providerKindOf(modelKey), modelKey, sharedKey });
    const bucket = this.bucketFor(`model:${modelKey}`);
    this.prune(bucket, now);
    const blocked = this.isBlocked(modelKey, sharedKey);
    return {
      rpmUsed: bucket.requests.length,
      rpmLimit: limits.rpm,
      tpmUsed: sumTokens(bucket),
      tpmLimit: limits.tpm,
      nextRetryAt: blocked.retryAt,
    };
  }

  snapshot(modelKeys?: string[]): ModelRateSnapshot[] {
    const now = this.now();
    const keys = modelKeys ?? [
      ...new Set([
        ...[...this.buckets.keys()].filter((k) => k.startsWith("model:")).map((k) => k.slice("model:".length)),
        ...[...this.blocked.keys()].filter((k) => k.startsWith("model:")).map((k) => k.slice("model:".length)),
        ...[...this.queueByModel.keys()],
        ...[...this.fallbackReasons.keys()],
      ]),
    ];
    return keys.map((modelKey) => {
      const bucket = this.bucketFor(`model:${modelKey}`);
      this.prune(bucket, now);
      const blocked = this.blockInfoIfActive(`model:${modelKey}`, now);
      // Efektif tanpa sharedKey (UI global); per-request shared tetap ditegakkan di acquire().
      const limits = this.getEffectiveLimits({ providerKind: providerKindOf(modelKey), modelKey });
      return {
        modelKey,
        providerKind: providerKindOf(modelKey),
        rpmUsed: bucket.requests.length,
        rpmLimit: limits.rpm,
        tpmUsed: sumTokens(bucket),
        tpmLimit: limits.tpm,
        rpdStatus: this.rpdByModel.get(modelKey) ?? null,
        queueLength: this.queueByModel.get(modelKey) ?? 0,
        nextRetryAt: blocked ? new Date(blocked.until).toISOString() : null,
        blockedReason: blocked?.reason ?? null,
        fallbackReason: this.fallbackReasons.get(modelKey) ?? null,
        isDailyQuotaExhausted: blocked?.isDailyQuota ?? false,
      };
    });
  }

  getGlobalQueue(): number {
    return this.globalQueue;
  }

  reset(): void {
    this.buckets.clear();
    this.blocked.clear();
    this.fallbackReasons.clear();
    this.rpdByModel.clear();
    this.queueByModel.clear();
    this.globalQueue = 0;
  }
}

function sumTokens(bucket: Bucket): number {
  let s = 0;
  for (const e of bucket.tokens) s += e.tokens;
  return s;
}

function providerKindOf(modelKey: string): string {
  const idx = modelKey.indexOf(":");
  return idx > 0 ? modelKey.slice(0, idx) : "custom";
}

/** Singleton proses untuk seluruh request (chat, retry, background task). */
export const globalRateLimiter = new CentralRateLimiter();

/* ------------------------------------------------------------------ */
/* Checkpoint: status menunggu kuota tanpa crash agent (#6)            */
/* ------------------------------------------------------------------ */

export interface TaskCheckpoint {
  id: string;
  runId: string | null;
  conversationId: string | null;
  userId: string | null;
  userText: string | null;
  primaryModelKey: string | null;
  attemptedModels: string[];
  reason: string;
  fallbackReason: string | null;
  /** Mode policy saat checkpoint dibuat — wajib read-only agar aman. */
  policyMode: "read-only" | "write";
  status: "waiting_quota";
  nextRetryAt: string | null;
  createdAt: string;
}

export class CheckpointStore {
  private items = new Map<string, TaskCheckpoint>();

  save(input: Omit<TaskCheckpoint, "id" | "createdAt" | "status"> & { id?: string }): TaskCheckpoint {
    const id = input.id ?? `ckpt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const cp: TaskCheckpoint = {
      ...input,
      id,
      status: "waiting_quota",
      createdAt: new Date().toISOString(),
      // Paksa read-only: pemulihan tidak boleh mengaktifkan write tools.
      policyMode: "read-only",
    };
    this.items.set(id, cp);
    return cp;
  }

  get(id: string): TaskCheckpoint | null {
    return this.items.get(id) ?? null;
  }

  list(): TaskCheckpoint[] {
    return [...this.items.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  remove(id: string): boolean {
    return this.items.delete(id);
  }

  clear(): void {
    this.items.clear();
  }
}

export const globalCheckpoints = new CheckpointStore();
