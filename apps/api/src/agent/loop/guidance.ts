/**
 * Translate a policy denial code into clear guidance text that the AI model
 * must relay to the user. This prevents the model from silently swallowing
 * tool errors or misinterpreting them as "empty output".
 */
export function policyDenialGuidance(code: string, toolName: string): string {
  switch (code) {
    case "SAFE_MODE_UNAVAILABLE":
      return (
        `PERINTAH WAJIB: Tool "${toolName}" DITOLAK oleh sistem karena transaksi Safe Mode tidak aktif. ` +
        `JANGAN coba ulang tool ini — hasilnya akan sama. ` +
        `Laporkan ke pengguna: "Tool tulis ditolak karena transaksi Safe Mode tidak berhasil dibuka. ` +
        `Pastikan mode Write aktif di panel connector dan router tersambung, lalu coba lagi."`
      );
    case "WRITE_DISABLED":
      return (
        `PERINTAH WAJIB: Tool "${toolName}" DITOLAK karena mode saat ini Read-Only. ` +
        `JANGAN coba ulang. Beritahu pengguna untuk mengaktifkan mode Write di panel connector.`
      );
    case "POLICY_CHANGED":
      return (
        `Mode connector berubah saat run berlangsung. Beritahu pengguna bahwa sesi perlu dimulai ulang.`
      );
    case "FORBIDDEN":
      return `Akses ditolak. Beritahu pengguna tentang penolakan ini apa adanya.`;
    case "VALIDATION_FAILED":
      return `Argumen tool tidak valid. Periksa parameter dan coba dengan argumen yang benar.`;
    case "TOOL_UNSUPPORTED":
      return `Tool tidak tersedia dengan nama itu di katalog run ini. Jangan coba memanggil nama yang sama lagi — pilih nama persis dari daftar tools yang tersedia.`;
    default:
      return `Tool "${toolName}" ditolak dengan kode ${code}. Laporkan kode dan pesan error ke pengguna apa adanya.`;
  }
}

/**
 * Guidance for tool execution failures (after policy allowed, but MCP child returned error).
 */
export function toolFailGuidance(errorCode: string, toolName: string): string {
  if (errorCode === "WEB_SEARCH_NOT_CONFIGURED") {
    return (
      `Pencarian web belum dikonfigurasi (API key Tavily belum diisi). Beritahu pengguna untuk membuka Pengaturan → Deep Research ` +
      `dan menambahkan API key. JANGAN mencoba tool ini lagi pada giliran yang sama.`
    );
  }
  if (errorCode === "WEB_SEARCH_UNAUTHORIZED") {
    return (
      `API key Tavily ditolak sistem. Beritahu pengguna bahwa API key kemungkinan tidak valid/kedaluwarsa ` +
      `dan arahkan memperbaruinya di Pengaturan → Deep Research.`
    );
  }
  if (errorCode === "WEB_SEARCH_RATE_LIMITED") {
    return (
      `Pencarian web sedang dibatasi (rate limit). Beritahu pengguna untuk menunggu sebentar. ` +
      `Jangan mengulang tool ini berkali-kali pada giliran yang sama.`
    );
  }
  if (errorCode === "TOOL_FAILED") {
    return (
      `Tool "${toolName}" gagal dieksekusi. Periksa output error di atas dan laporkan ke pengguna. ` +
      `Jangan mengklaim operasi berhasil — verifikasi dulu dengan tool baca sebelum membuat klaim apapun.`
    );
  }
  if (errorCode === "TOOL_UNSUPPORTED") {
    return (
      `Tool "${toolName}" tidak tersedia dengan nama itu. Jangan ulangi nama yang sama — ` +
      `pilih nama tool persis dari daftar tools yang tersedia (tanpa menambah prefix seperti "mt_").`
    );
  }
  return `Tool "${toolName}" error (${errorCode}). Laporkan ke pengguna apa adanya, jangan mengarang hasil.`;
}
