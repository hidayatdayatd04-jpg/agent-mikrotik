import { AppError } from "../../lib/errors";
import { redactText } from "../../lib/redaction";
import type { ProviderConfigWithKey } from "../provider-settings";
import { isDailyQuotaError } from "../provider-limits";

/** Translates an OpenAI SDK error into a typed AppError with an actionable message. */
export function toProviderError(err: unknown, cfg: ProviderConfigWithKey): AppError {
  const apiErr = err as { status?: number; message?: string; code?: string; headers?: Headers | Record<string, string>; error?: { message?: string; code?: string | number } } | null;
  const status = typeof apiErr?.status === "number" ? apiErr.status : 0;
  const raw = redactText(String(apiErr?.error?.message || apiErr?.message || (err instanceof Error ? err.message : String(err))).split(cfg.apiKey).join("[REDACTED]"));
  if (err instanceof AppError) return err;

  // Detect rate limit / quota exceeded from message even if status code differs
  const isQuota = status === 429 || apiErr?.error?.code === 429 || (status === 0 && /resource_exhausted|rate limit exceeded|quota exceeded/i.test(raw));

  if (isQuota) {
    // Extract retry delay if available in message (e.g. "Please retry in 11.4s")
    const retryMatch = raw.match(/retry in\s+([\d.]+s?)/i);
    const retryNote = retryMatch ? ` Silakan tunggu ${retryMatch[1]} sebelum mencoba lagi.` : "";
    if (isDailyQuotaError(status === 0 ? 429 : status, raw)) {
      return new AppError(
        "UPSTREAM_QUOTA_EXHAUSTED",
        `Kuota harian provider habis (429) pada ${cfg.name ?? cfg.kind} / ${cfg.model}.${retryNote} Penggunaan model ini dihentikan sementara sampai kuota tersedia kembali; sistem akan memakai model cadangan bila tersedia. Permintaan ini tidak di-retry. Detail: ${raw.slice(0, 300)}`,
        502,
      );
    }
    return new AppError(
      "UPSTREAM_RATE_LIMITED",
      `Rate limit provider tercapai (429) pada ${cfg.name ?? cfg.kind} / ${cfg.model}.${retryNote} Batas dapat berlaku bersama pada akun/project; mengganti model belum tentu mereset kuota. Lihat status limit di Provider AI. Detail: ${raw.slice(0, 300)}`,
      502,
    );
  }
  if (status === 401 || status === 403) {
    return new AppError("UPSTREAM_AUTH_FAILED", `Provider menolak kredensial (${status}). Periksa API Key di menu Pengaturan. Detail: ${raw.slice(0, 250)}`, 400);
  }
  if (status === 404) {
    return new AppError("UPSTREAM_ERROR", `Nama model tidak ditemukan pada provider (404). Periksa Nama Model di menu Pengaturan atau klik "Ambil Daftar Model". Detail: ${raw.slice(0, 250)}`, 502);
  }
  if (status === 400) {
    return new AppError(
      "UPSTREAM_INVALID_REQUEST",
      `Permintaan ditolak oleh provider AI (400, argumen tidak valid) pada ${cfg.name ?? cfg.kind} / ${cfg.model}. ` +
        `Ini kesalahan format permintaan, bukan kuota — tidak di-retry agar kuota tidak terbuang. ` +
        `Bila gagal sejak request pertama, periksa Nama Model di menu Pengaturan (model mungkin tidak tersedia di endpoint ini). Detail: ${raw.slice(0, 300)}`,
      502,
    );
  }
  if (status >= 500) {
    return new AppError("UPSTREAM_ERROR", `Provider mengalami gangguan (${status}). Coba lagi sebentar. Detail: ${raw.slice(0, 250)}`, 502);
  }
  if (apiErr?.code === "ECONNREFUSED" || apiErr?.code === "ENOTFOUND" || apiErr?.code === "EAI_AGAIN") {
    return new AppError("UPSTREAM_ERROR", `Tidak dapat terhubung ke provider (${apiErr.code}). Periksa Base URL di menu Pengaturan.`, 502);
  }
  const timedOut = err instanceof Error && /timeout|timed out/i.test(err.message);
  if (timedOut || apiErr?.code === "ETIMEDOUT" || apiErr?.code === "ABORT_ERR") {
    return new AppError("UPSTREAM_TIMEOUT", "Provider tidak merespons dalam batas waktu.", 504);
  }
  return new AppError("UPSTREAM_ERROR", `Gagal berkomunikasi dengan provider AI. Detail: ${raw.slice(0, 250)}`, 502);
}
