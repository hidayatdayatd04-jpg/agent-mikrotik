export function classifyHint(code: string, message?: string): string {
  switch (code) {
    case "SSH_AUTH_FAILED":
      return "Username atau password SSH salah. Jika router baru / default MikroTik CHR, password bawaan biasanya kosong (coba kosongkan field password).";
    case "SSH_UNREACHABLE":
      return "Host tidak terjangkau atau port SSH ditolak. Pastikan service SSH aktif di menu 'IP > Services' pada WinBox.";
    case "SSH_TIMEOUT":
      return "Koneksi SSH kehabisan waktu (timeout). Periksa firewall atau konektivitas jaringan host ke router.";
    case "HOST_KEY_CHANGED":
      return "Fingerprint host key router berubah. Periksa apakah router baru diganti atau di-reset.";
    case "HOST_NOT_ALLOWED":
      return "Alamat router ditolak oleh kebijakan keamanan target lokal.";
    case "VALIDATION_FAILED":
      return "Periksa kembali data pada form di atas yang ditandai merah.";
    default:
      if (message && message.includes("400")) {
        return "Periksa kembali username, password, atau konfigurasi SSH router Anda di WinBox.";
      }
      return "";
  }
}
