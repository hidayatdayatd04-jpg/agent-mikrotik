import { X } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { useBackup } from "./backup-hooks";
import { formatBytes } from "./backup-format";

export function BackupViewerModal(props: { viewingBackupId: string | null; onClose: () => void }) {
  const backupDetail = useBackup(props.viewingBackupId);
  if (!props.viewingBackupId) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
      <div className="w-full max-w-4xl max-h-[85vh] flex flex-col rounded-2xl border border-border/80 bg-popover shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border/60">
          <div>
            <h3 className="text-sm font-bold text-foreground">{backupDetail.data?.name || "Isi Konfigurasi"}</h3>
            <p className="text-xs text-muted-foreground">Export RouterOS (Kredensial sensitif diredaksi otomatis)</p>
          </div>
          <button
            type="button"
            onClick={props.onClose}
            className="rounded-lg p-1 text-muted-foreground hover:text-foreground cursor-pointer"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="flex-1 overflow-auto p-4 bg-muted/20">
          {backupDetail.isLoading ? (
            <div className="py-20 text-center text-xs text-muted-foreground">Memuat isi konfigurasi…</div>
          ) : (
            <pre className="font-mono text-xs text-foreground/90 whitespace-pre-wrap leading-relaxed select-text">
              {backupDetail.data?.content || "Tidak ada konten."}
            </pre>
          )}
        </div>

        <div className="flex items-center justify-between px-5 py-3 border-t border-border/60 bg-muted/40">
          <span className="text-[11px] text-muted-foreground">Ukuran: {formatBytes(backupDetail.data?.sizeBytes ?? 0)}</span>
          <Button size="sm" onClick={props.onClose}>
            Tutup
          </Button>
        </div>
      </div>
    </div>
  );
}
