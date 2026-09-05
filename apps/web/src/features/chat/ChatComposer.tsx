import { useRef, useState, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, Paperclip, Send, X } from "lucide-react";
import { toast } from "sonner";
import type { AttachmentDTO } from "./chat-hooks";
import { fmtSize } from "./ChatPanel";

/**
 * Composer (M9): multiline (Enter kirim, Shift+Enter baris baru, IME-safe),
 * draft per chat, lampiran dengan preview chip sebelum kirim.
 */
export function ChatComposer(props: {
  disabled?: boolean;
  running: boolean;
  attachments: AttachmentDTO[];
  uploading: boolean;
  onPickFile: (file: File) => void;
  onRemoveAttachment: (id: string) => void;
  onSend: (text: string, attachmentIds: string[]) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState("");
  const [imeComposing, setImeComposing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !imeComposing) {
      e.preventDefault();
      submit();
    }
  }

  function submit() {
    const trimmed = text.trim();
    if (!trimmed || props.disabled || props.running) return;
    props.onSend(trimmed, props.attachments.map((a) => a.id));
    setText("");
  }

  return (
    <div className="border-t bg-background px-4 py-3">
      <div className="mx-auto max-w-3xl">
        {props.attachments.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {props.attachments.map((a) => (
              <span
                key={a.id}
                className="flex items-center gap-1.5 rounded-md border bg-muted px-2.5 py-1 text-xs"
                title={`${a.originalName} (${fmtSize(a.sizeBytes)})`}
              >
                <Paperclip className="size-3" aria-hidden />
                {a.originalName.length > 28 ? `${a.originalName.slice(0, 25)}…` : a.originalName}
                <span className="text-muted-foreground">{fmtSize(a.sizeBytes)}</span>
                <button
                  type="button"
                  onClick={() => props.onRemoveAttachment(a.id)}
                  className="rounded-full p-0.5 hover:bg-foreground/10"
                  aria-label={`Hapus lampiran ${a.originalName}`}
                >
                  <X className="size-3" aria-hidden />
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="flex items-end gap-2 rounded-2xl border bg-muted/40 p-2 focus-within:border-ring">
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            accept=".png,.jpg,.jpeg,.webp,.pdf,.txt,.csv,.log,.rsc"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) props.onPickFile(f);
              e.target.value = "";
            }}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-9 shrink-0"
            onClick={() => fileInputRef.current?.click()}
            disabled={props.disabled || props.running || props.uploading || props.attachments.length >= 4}
            aria-label="Tambah lampiran"
            title="Tambah lampiran (maks 4, 10 MiB)"
          >
            {props.uploading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Paperclip className="size-4" aria-hidden />}
          </Button>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            onCompositionStart={() => setImeComposing(true)}
            onCompositionEnd={() => setImeComposing(false)}
            placeholder={props.running ? "Agent sedang menjawab…" : "Tanya apa saja tentang RouterOS… (Enter kirim, Shift+Enter baris baru)"}
            rows={1}
            disabled={props.disabled}
            className="max-h-40 min-h-9 flex-1 resize-none bg-transparent px-1 py-1.5 text-sm outline-none placeholder:text-muted-foreground disabled:opacity-50"
            style={{ height: "auto" }}
          />
          {props.running ? (
            <Button type="button" size="sm" variant="outline" onClick={props.onCancel} className="shrink-0 gap-1.5">
              Stop
            </Button>
          ) : (
            <Button
              type="button"
              size="icon"
              className="size-9 shrink-0"
              onClick={submit}
              disabled={props.disabled || !text.trim()}
              aria-label="Kirim pesan"
            >
              <Send className="size-4" aria-hidden />
            </Button>
          )}
        </div>
        <p className="mt-1.5 px-1 text-[11px] text-muted-foreground">
          {props.attachments.length >= 4 ? "Maksimal 4 lampiran per pesan" : "PNG/JPG/WebP/PDF/TXT/CSV/LOG/RSC · maks 10 MiB"}
        </p>
      </div>
    </div>
  );
}

export function toastAttachmentError(msg: string) {
  toast.error(msg);
}
