/**
 * Helper kartu error run: judul/petunjuk per kode + pemisah format lama.
 *
 * Format lama (sebelum kartu error ada) menyisipkan penutup kegagalan ke
 * dalam teks chat: "\n\n---\nPemeriksaan belum selesai (KODE): ...".
 * Helper ini memisahkannya kembali agar riwayat lama pun tampil sebagai
 * kartu error, bukan bubble chat.
 */

/** Penanda awal blok penutup kegagalan pada format lama. */
const LEGACY_MARKER = "\n\n---\nPemeriksaan belum selesai (";

/** Pisahkan teks chat dari blok notice kegagalan format lama. */
export function splitLegacyFailureNotice(text: string): { chat: string; hadNotice: boolean } {
  const idx = text.indexOf(LEGACY_MARKER);
  if (idx < 0) return { chat: text, hadNotice: false };
  return { chat: text.slice(0, idx).trimEnd(), hadNotice: true };
}

export interface RunErrorInfo {
  code: string;
  reason: string;
  toolSucceeded: number;
  toolFailed: number;
}

/** Judul Bahasa Indonesia per kode kegagalan run. */
export function runErrorTitle(code: string): string {
  switch (code) {
    case "UPSTREAM_QUOTA_EXHAUSTED":
      return "Kuota AI habis";
    case "UPSTREAM_RATE_LIMITED":
      return "Rate limit AI tercapai";
    case "UPSTREAM_TIMEOUT":
      return "Provider AI timeout";
    case "UPSTREAM_AUTH_FAILED":
      return "Kunci API ditolak";
    case "UPSTREAM_INVALID_REQUEST":
      return "Permintaan ditolak provider";
    case "UPSTREAM_ERROR":
      return "Provider AI gangguan";
    case "STEP_LIMIT_REACHED":
      return "Batas langkah tercapai";
    case "RUN_TIMEOUT":
      return "Waktu pemeriksaan habis";
    case "EMPTY_RESPONSE":
      return "Respons AI kosong";
    case "RUN_ALREADY_ACTIVE":
      return "Masih ada pemeriksaan berjalan";
    case "CANCELLED":
      return "Pemeriksaan dibatalkan";
    default:
      return "Pemeriksaan belum selesai";
  }
}

/** Petunjuk tindak lanjut singkat per kode kegagalan. */
export function runErrorHint(code: string): string | null {
  switch (code) {
    case "UPSTREAM_QUOTA_EXHAUSTED":
      return "Kuota harian model ini habis. Coba lagi setelah reset, atau ganti model lain.";
    case "UPSTREAM_RATE_LIMITED":
      return "Terlalu banyak permintaan sesaat. Tunggu sebentar lalu coba lagi.";
    case "UPSTREAM_TIMEOUT":
      return "Provider tidak merespons tepat waktu. Coba lagi sebentar.";
    case "UPSTREAM_AUTH_FAILED":
      return "Periksa API key di Pengaturan → Provider AI.";
    case "UPSTREAM_INVALID_REQUEST":
      return "Periksa nama model di Pengaturan → Provider AI.";
    case "UPSTREAM_ERROR":
      return "Gangguan sementara di sisi provider. Coba lagi sebentar.";
    case "STEP_LIMIT_REACHED":
      return "Pekerjaan terlalu besar untuk satu run. Lanjutkan untuk meneruskan sisanya.";
    case "RUN_TIMEOUT":
      return "Lanjutkan untuk meneruskan sisa pekerjaan.";
    default:
      return null;
  }
}

/** Baris progres pembacaan yang sudah tersimpan (null bila tak ada progres). */
export function runErrorProgress(info: Pick<RunErrorInfo, "toolSucceeded" | "toolFailed">): string | null {
  const total = info.toolSucceeded + info.toolFailed;
  if (total <= 0) return null;
  return `Hasil yang sudah terbaca tetap tersimpan: ${info.toolSucceeded} berhasil, ${info.toolFailed} gagal dari ${total} pemanggilan tool.`;
}

/** Normalisasi outcome pesan / payload event menjadi info kartu error. */
export function toRunErrorInfo(input: {
  code?: unknown;
  reason?: unknown;
  message?: unknown;
  toolSucceeded?: unknown;
  toolFailed?: unknown;
}): RunErrorInfo {
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);
  return {
    code: typeof input.code === "string" && input.code ? input.code : "RUN_FAILED",
    reason:
      typeof input.reason === "string" && input.reason
        ? input.reason
        : typeof input.message === "string" && input.message
          ? input.message
          : "Terjadi kendala saat memproses permintaan.",
    toolSucceeded: num(input.toolSucceeded),
    toolFailed: num(input.toolFailed),
  };
}
