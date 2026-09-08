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

export {
  DEFAULT_GLOBAL_RPM,
  DEFAULT_GLOBAL_TPM,
  RATE_WINDOW_MS,
  MAX_QUEUE_DEFAULT,
  MAX_WAIT_MS_DEFAULT,
  MAX_429_RETRIES_DEFAULT,
} from "./rate-limiter/types";
export type {
  ProviderKindLabel,
  RateLimitOverride,
  EffectiveLimits,
  LimiterOptions,
  AcquireInput,
  AcquireTicket,
  BlockInfo,
  ModelRateSnapshot,
} from "./rate-limiter/types";
export {
  sharedKeyForApiKey,
  modelKeyFor,
  estimateTokensFromChars,
  estimateRequestTokens,
  computeBackoffWithJitter,
  parseRetryAfterMs,
  classifyQuotaError,
  nextMidnightUtcMs,
} from "./rate-limiter/estimate";
export type { QuotaKind } from "./rate-limiter/estimate";
export { CentralRateLimiter, globalRateLimiter } from "./rate-limiter/core";
export { CheckpointStore, globalCheckpoints } from "./rate-limiter/checkpoints";
export type { TaskCheckpoint } from "./rate-limiter/checkpoints";
