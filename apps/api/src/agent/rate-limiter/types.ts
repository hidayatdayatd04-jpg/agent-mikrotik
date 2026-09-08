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
