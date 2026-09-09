import { Trash2, Download, FileDiff } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { formatBytes } from "./backup-format";
import type { ConfigBackupDTO } from "@shared/index";

export function BackupTable(props: {
  items: ConfigBackupDTO[];
  loading: boolean;
  selectedForCompare: string[];
  onToggleCompare: (id: string) => void;
  onCompareLive: (b: ConfigBackupDTO) => void;
  onView: (id: string) => void;
  onDelete: (b: ConfigBackupDTO) => void;
}) {
  const { items, loading, selectedForCompare } = props;
  return (
    <div className="rounded-2xl border border-border/60 bg-card overflow-hidden shadow-xs">
      <div className="px-5 py-3.5 border-b border-border/50 flex items-center justify-between">
        <h3 className="text-xs font-bold text-foreground">Daftar Snapshot Konfigurasi</h3>
        <span className="text-[11px] text-muted-foreground">{items.length} Snapshot Tersimpan</span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs border-collapse">
          <thead>
            <tr className="border-b border-border/40 bg-muted/20 text-muted-foreground text-[11px]">
              <th className="w-10 px-4 py-2.5 text-center">Pilih</th>
              <th className="px-4 py-2.5 font-semibold">Nama Backup</th>
              <th className="px-4 py-2.5 font-semibold">Identitas Router</th>
              <th className="px-4 py-2.5 font-semibold">Ukuran</th>
              <th className="px-4 py-2.5 font-semibold">Pembuat</th>
              <th className="px-4 py-2.5 font-semibold">Waktu Pembuatan</th>
              <th className="px-4 py-2.5 font-semibold">Status</th>
              <th className="px-4 py-2.5 text-right font-semibold">Aksi</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/30">
            {items.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-5 py-10 text-center text-muted-foreground">
                  {loading
                    ? "Memuat daftar backup…"
                    : "Belum ada backup untuk router ini. Klik 'Buat Snapshot' untuk membuat export pertama."}
                </td>
              </tr>
            ) : (
              items.map((b) => {
                const isSelected = selectedForCompare.includes(b.id);
                return (
                  <tr key={b.id} className={`hover:bg-accent/30 transition-colors ${isSelected ? "bg-accent/50" : ""}`}>
                    <td className="px-4 py-3 text-center">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => props.onToggleCompare(b.id)}
                        className="rounded border-border cursor-pointer"
                        title="Pilih untuk perbandingan diff"
                      />
                    </td>
                    <td className="px-4 py-3 font-semibold text-foreground">{b.name}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {b.routerIdentity || "—"} ({b.boardName || "RouterOS"})
                    </td>
                    <td className="px-4 py-3 font-mono text-[11px]">{formatBytes(b.sizeBytes)}</td>
                    <td className="px-4 py-3">
                      <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">{b.createdBy}</span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground text-[11px]">{new Date(b.createdAt).toLocaleString("id-ID")}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-semibold ${
                          b.status === "completed"
                            ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                            : b.status === "failed"
                              ? "bg-rose-500/10 text-rose-600 dark:text-rose-400"
                              : "bg-amber-500/10 text-amber-600"
                        }`}
                      >
                        {b.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => props.onCompareLive(b)}
                          className="h-7 px-2 text-[11px] gap-1 cursor-pointer"
                          title="Bandingkan dengan konfigurasi berjalan saat ini"
                        >
                          <FileDiff className="size-3" />
                          Diff Live
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => props.onView(b.id)}
                          className="h-7 px-2 text-[11px] cursor-pointer"
                        >
                          Lihat
                        </Button>
                        <a
                          href={`/api/backups/${b.id}/export`}
                          download={`${b.name}.rsc`}
                          className="inline-flex items-center justify-center h-7 w-7 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent cursor-pointer"
                          title="Unduh file .rsc (aman, password diredaksi)"
                        >
                          <Download className="size-3.5" />
                        </a>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => void props.onDelete(b)}
                          className="size-7 text-muted-foreground hover:text-destructive cursor-pointer"
                          title="Hapus backup"
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
