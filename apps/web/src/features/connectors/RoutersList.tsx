import { Button } from "@/components/ui/button";
import { Server, Plus, RefreshCw, AlertCircle, Lock } from "@/components/icons";
import type { ConnectorDTO } from "@shared/index";
import { ConnectorRow } from "./ConnectorRow";

export function RoutersList(props: {
  connectors: ConnectorDTO[] | undefined;
  isLoading: boolean;
  error: Error | null;
  returnTo?: string | null;
  onUseInChat?: (id: string) => void;
  onRefetch: () => void;
  onAdd: () => void;
}) {
  const { connectors, isLoading, error } = props;
  return (
    <div className="rounded-2xl border border-border/70 bg-card/40 p-5 space-y-4">
      <div className="flex items-center justify-between border-b border-border/60 pb-3">
        <h2 className="text-sm font-semibold">Daftar Router</h2>
        <Button variant="ghost" size="sm" onClick={props.onRefetch} className="h-7 text-xs gap-1 text-muted-foreground">
          <RefreshCw className="size-3" />
          Segarkan
        </Button>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-12 text-sm text-muted-foreground gap-2">
          <RefreshCw className="size-4 animate-spin text-indigo-500" />
          <span>Memuat daftar router…</span>
        </div>
      )}

      {error && (
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <AlertCircle className="size-8 text-destructive mb-2" />
          <p className="text-sm font-medium text-destructive">Gagal memuat daftar router.</p>
          <p className="text-xs text-muted-foreground mt-1">Pastikan server backend API sedang berjalan di port 3001.</p>
          <Button variant="outline" size="sm" onClick={props.onRefetch} className="mt-3 text-xs gap-1.5">
            <RefreshCw className="size-3" /> Coba Lagi
          </Button>
        </div>
      )}

      {!isLoading && !error && (connectors ?? []).length === 0 && (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <div className="flex size-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground mb-3">
            <Server className="size-6" />
          </div>
          <p className="text-sm font-semibold text-foreground">Belum ada router yang ditambahkan</p>
          <p className="max-w-sm text-xs text-muted-foreground mt-1">
            Tambahkan router MikroTik Anda untuk mulai menjalankan perintah monitoring dan konfigurasi lewat AI Agent.
          </p>
          <Button onClick={props.onAdd} className="mt-4 gap-1.5 text-xs bg-indigo-600 hover:bg-indigo-500 text-white font-medium">
            <Plus className="size-3.5" /> Tambah Router Sekarang
          </Button>
        </div>
      )}

      {props.returnTo && (
        <div className="flex items-center justify-between gap-2 rounded-xl border border-indigo-500/40 bg-indigo-500/10 px-3 py-2 text-xs">
          <span>Menambah router untuk chat — draft dan lampiran tetap tersimpan.</span>
          <a href={props.returnTo} className="font-medium text-indigo-600 hover:underline dark:text-indigo-400">
            Kembali ke chat
          </a>
        </div>
      )}
      <div className="space-y-3">
        {(connectors ?? []).map((c) => (
          <div key={c.id} className="space-y-2">
            <ConnectorRow connector={c} />
            {props.onUseInChat && c.status === "connected" && (
              <Button size="sm" variant="outline" className="w-full text-xs" onClick={() => props.onUseInChat?.(c.id)}>
                Gunakan di chat ini
              </Button>
            )}
          </div>
        ))}
      </div>

      {/* Security footer notice */}
      <div className="flex items-start gap-2.5 rounded-xl border border-border/60 bg-muted/30 p-3.5 text-xs text-muted-foreground">
        <Lock className="size-4 text-indigo-500 shrink-0 mt-0.5" />
        <p className="leading-relaxed">
          Router baru selalu dimulai dalam mode <strong>Read-Only</strong> untuk keamanan. Mode Write hanya dapat diaktifkan pada koneksi yang sedang
          terhubung dan akan otomatis dicabut saat koneksi diputus.
        </p>
      </div>
    </div>
  );
}
