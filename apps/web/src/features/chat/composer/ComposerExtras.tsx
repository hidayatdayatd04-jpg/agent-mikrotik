import { FileText, X, ShieldCheck } from "@/components/icons";
import { fmtSize } from "../ChatPanel";
import type { AttachmentDTO } from "../chat-hooks";
import type { ConnectorDTO } from "@shared/index";

export function ComposerAttachments(props: { attachments: AttachmentDTO[]; onRemoveAttachment: (id: string) => void }) {
  if (props.attachments.length === 0) return null;
  return (
    <div className="mb-2.5 flex flex-wrap gap-2">
      {props.attachments.map((a) => (
        <span
          key={a.id}
          className="flex items-center gap-1.5 rounded-xl border border-border/80 bg-card/90 px-2.5 py-1 text-xs shadow-xs"
          title={`${a.originalName} (${fmtSize(a.sizeBytes)})`}
        >
          <FileText className="size-3.5 text-indigo-500" />
          <span className="max-w-[160px] truncate font-medium">{a.originalName}</span>
          <span className="text-[11px] text-muted-foreground">{fmtSize(a.sizeBytes)}</span>
          <button
            type="button"
            onClick={() => props.onRemoveAttachment(a.id)}
            className="rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors cursor-pointer"
            aria-label={`Hapus lampiran ${a.originalName}`}
          >
            <X className="size-3" />
          </button>
        </span>
      ))}
    </div>
  );
}

export function ComposerBadges(props: { connector?: ConnectorDTO | null; writeEnabled: boolean }) {
  const { connector, writeEnabled } = props;
  return (
    <>
      {connector && (
        <span
          className="hidden sm:inline-flex items-center gap-1.5 rounded-lg bg-muted/60 border border-border/50 px-2 py-1 text-[11px] text-foreground max-w-[140px] truncate"
          title={`${connector.label} (${connector.host})`}
        >
          <span className={`size-1.5 rounded-full shrink-0 ${connector.status === "connected" ? "bg-emerald-500" : "bg-muted-foreground/40"}`} />
          <span className="truncate font-medium">{connector.label}</span>
        </span>
      )}

      {connector && writeEnabled && (
        <span
          className="inline-flex items-center gap-1 rounded-lg bg-amber-500/10 border border-amber-500/20 px-2 py-1 text-[10px] font-semibold text-amber-600 dark:text-amber-400"
          title="Mode Write aktif: Perubahan diizinkan dalam Safe Mode"
        >
          <ShieldCheck className="size-3 text-amber-500 shrink-0" />
          <span>Write aktif</span>
        </span>
      )}

      {connector && !writeEnabled && (
        <span
          className="inline-flex items-center gap-1 rounded-lg bg-sky-500/10 border border-sky-500/20 px-2 py-1 text-[10px] font-semibold text-sky-600 dark:text-sky-400"
          title="Mode Read-Only: Konfigurasi router aman dan tidak diubah"
        >
          <ShieldCheck className="size-3 text-sky-500 shrink-0" />
          <span>Read-Only</span>
        </span>
      )}

      {!connector && (
        <span className="rounded-lg bg-muted px-2 py-1 text-[10px] font-medium text-muted-foreground">Belum terhubung</span>
      )}
    </>
  );
}
