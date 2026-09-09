import { ShieldCheck } from "@/components/icons";

export function SafeModeTab() {
  return (
    <div className="space-y-4 animate-in fade-in duration-200">
      <div className="rounded-2xl border border-border/70 bg-card/60 p-6 space-y-4">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400">
            <ShieldCheck className="size-5" />
          </div>
          <div>
            <h2 className="text-base font-semibold">MikroTik Safe Mode & Write Mode Safeguard</h2>
            <p className="text-xs text-muted-foreground">
              Mekanisme proteksi berlapis untuk mencegah kehilangan akses router akibat kesalahan konfigurasi.
            </p>
          </div>
        </div>

        <div className="grid gap-3 pt-2 sm:grid-cols-2">
          <div className="rounded-xl border border-border/70 bg-background/60 p-4">
            <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <span className="size-2 rounded-full bg-blue-500" />
              Mode Default: Read-Only
            </h3>
            <p className="mt-1.5 text-xs text-muted-foreground leading-relaxed">
              Semua koneksi router yang baru ditambahkan selalu berstatus <strong>Read-Only</strong>. Agen AI hanya diperbolehkan membaca data
              (seperti status interface, tabel ARP, firewall rules, IP route, log) dan tidak dapat mengubah apa pun.
            </p>
          </div>

          <div className="rounded-xl border border-border/70 bg-background/60 p-4">
            <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <span className="size-2 rounded-full bg-amber-500" />
              Safe Mode Otomatis
            </h3>
            <p className="mt-1.5 text-xs text-muted-foreground leading-relaxed">
              Ketika <strong>Write Mode</strong> diaktifkan secara manual, setiap perubahan dieksekusi di dalam transaksi RouterOS Safe Mode. Jika
              koneksi terputus atau terjadi kesalahan fatal, RouterOS akan secara otomatis membatalkan seluruh perubahan (rollback).
            </p>
          </div>
        </div>

        <div className="rounded-xl bg-muted/40 p-4 text-xs text-muted-foreground leading-relaxed space-y-2 border border-border/50">
          <p className="font-medium text-foreground">Kebijakan Keamanan Agen:</p>
          <ul className="list-disc pl-4 space-y-1">
            <li>Kredensial SSH router disimpan terenkripsi secara lokal (AES-256-GCM).</li>
            <li>Kata sandi router tidak pernah diteruskan ke model bahasa (LLM).</li>
            <li>Write Mode otomatis dicabut ketika sesi koneksi router ditutup atau diputus.</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
