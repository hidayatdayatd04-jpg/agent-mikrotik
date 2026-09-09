export function HelpSection() {
  return (
    <div className="space-y-3 rounded-2xl border border-border/70 bg-card/60 p-6 text-sm leading-relaxed">
      <h2 className="text-base font-semibold">Bantuan</h2>
      <h3 className="font-semibold">Connector SSH</h3>
      <p className="text-xs text-muted-foreground">
        Tambahkan router via Pengaturan → Connector Router. SSH probe memverifikasi kredensial dan identity; discovery/Winbox bukan bukti SSH aktif.
        Jangan gunakan port 8291 untuk SSH (port SSH default 22).
      </p>
      <h3 className="font-semibold">Penggunaan Write</h3>
      <p className="text-xs text-muted-foreground">
        Aktifkan Izinkan perubahan di menu (+) composer hanya saat connected dan identity terverifikasi. Mutasi berjalan dalam transaksi Safe Mode;
        gagal/cancel → rollback, kosong → rollback empty.
      </p>
      <h3 className="font-semibold">Pemulihan koneksi</h3>
      <p className="text-xs text-muted-foreground">
        Disconnect, Write OFF, logout, dan restart mengikuti cleanup backend. Tutup panel bukan bukti command berhenti — periksa status final yang jujur.
      </p>
    </div>
  );
}
