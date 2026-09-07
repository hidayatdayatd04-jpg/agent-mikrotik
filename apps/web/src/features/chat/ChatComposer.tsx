import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, Plus, Send, X, Square, FileText, ImagePlus, ShieldCheck, Sparkles, ChevronDown, Check, Scissors } from "lucide-react";
import { toast } from "sonner";
import type { AttachmentDTO } from "./chat-hooks";
import { fmtSize } from "./ChatPanel";
import type { ConnectorDTO } from "@shared/index";
import { useSetConnectorMode, useWriteReadiness } from "@/features/connectors/connector-hooks";
import { ContextMeter } from "./ContextMeter";
import { ConnectorSubmenu } from "./ConnectorPicker";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuCheckboxItem } from "@/components/ui/dropdown-menu";
import { useAiProviders } from "./chat-hooks";
import { readProviderSelection, resolveProviderSelection, SELECTION_KEY } from "./provider-selection";
import { ModelLimitIndicator } from "./ModelLimitIndicator";

export function ChatComposer(props: {
  disabled?: boolean;
  running: boolean;
  cancelling?: boolean;
  conversationId?: string;
  connector?: ConnectorDTO | null;
  connectors?: ConnectorDTO[];
  selectedConnectorId?: string | null;
  onSelectConnector?: (id: string) => void;
  attachments: AttachmentDTO[];
  uploading: boolean;
  externalText?: string;
  onClearExternalText?: () => void;
  onPickFile: (file: File) => void;
  onRemoveAttachment: (id: string) => void;
  onSend: (text: string, attachmentIds: string[], model?: string, providerId?: string) => void;
  onCancel: () => void;
  onAddRouter?: () => void;
  onCompact?: () => void;
  draftKey?: string;
}) {
  const [text, setText] = useState(() => {
    if (!props.draftKey) return "";
    try {
      return localStorage.getItem(props.draftKey) ?? sessionStorage.getItem("composer-draft") ?? "";
    } catch {
      return "";
    }
  });
  const [imeComposing, setImeComposing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const setMode = useSetConnectorMode(props.connector?.id ?? "");
  const readiness = useWriteReadiness(props.connector?.id ?? null);
  const writeEnabled = props.connector?.mode === "write";
  const uploadDisabled = props.disabled || props.running || props.uploading || props.attachments.length >= 4;

  const aiProviders = useAiProviders();
  const enabledProviders = aiProviders.data?.filter((p) => p.enabled) ?? [];
  const availableModels: { model: string; providerId: string; providerName: string }[] = [];
  for (const p of enabledProviders) {
    for (const m of p.models || []) {
      availableModels.push({ model: m, providerId: p.id, providerName: p.name });
    }
  }

  const [selection, setSelection] = useState(readProviderSelection);
  const effectiveSelection = resolveProviderSelection(aiProviders.data ?? [], selection);
  const effectiveModel = effectiveSelection?.model ?? "";
  const effectiveProvider = enabledProviders.find((p) => p.id === effectiveSelection?.providerId);

  // Persist draft (non-secret) for returnTo flow.
  useEffect(() => {
    if (!props.draftKey) return;
    try {
      localStorage.setItem(props.draftKey, text);
      sessionStorage.setItem("composer-draft", text);
    } catch {
      /* ignore */
    }
  }, [text, props.draftKey]);

  function pickFile(images: boolean) {
    if (!fileInputRef.current) return;
    fileInputRef.current.accept = images ? ".png,.jpg,.jpeg,.webp" : ".pdf,.txt,.csv,.log,.rsc";
    fileInputRef.current.click();
  }
  function toggleWrite(enabled: boolean) {
    if (!props.connector) return;
    // Never auto-enable Write on connector switch; explicit toggle only.
    setMode.mutate({ mode: enabled ? "write" : "read-only", expectedVersion: props.connector.modeVersion }, {
      onSuccess: (res) => {
        if (res.connector.mode === "write") {
          void readiness.refetch().then(({ data }) => {
            if (data?.blocked === "empty-credential") {
              toast.warning("Mode Write aktif, tetapi password admin masih kosong — tulis tetap diblokir. Isi password admin dulu.");
            } else {
              toast.success("Mode Write aktif — perintah perubahan dijalankan dalam Safe Mode.");
            }
          });
        } else {
          toast.info("Mode Read-Only aktif — konfigurasi router tidak diubah.");
        }
      },
      onError: (err) => toast.error(err.message),
    });
  }

  useEffect(() => {
    if (props.externalText) {
      setText(props.externalText);
      props.onClearExternalText?.();
      textareaRef.current?.focus();
    }
  }, [props.externalText, props.onClearExternalText]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 180)}px`;
    }
  }, [text]);

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !imeComposing) {
      e.preventDefault();
      submit();
    }
  }

  function submit() {
    const trimmed = text.trim();
    if (!trimmed || props.disabled || props.running || props.uploading || setMode.isPending) return;
    props.onSend(
      trimmed,
      props.attachments.map((a) => a.id),
      effectiveModel || undefined,
      effectiveSelection?.providerId
    );
    setText("");
    try {
      if (props.draftKey) localStorage.setItem(props.draftKey, "");
      sessionStorage.setItem("composer-draft", "");
    } catch {
      /* ignore */
    }
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }

  const connectors = props.connectors ?? (props.connector ? [props.connector] : []);
  const selectedId = props.selectedConnectorId ?? props.connector?.id ?? null;

  return (
    <div className="border-t border-border/60 bg-background/80 backdrop-blur-md px-3 py-3 sm:px-6 sm:py-4">
      <div className="mx-auto max-w-3xl">
        {props.attachments.length > 0 && (
          <div className="mb-2.5 flex flex-wrap gap-2">
            {props.attachments.map((a) => (
              <span
                key={a.id}
                className="flex items-center gap-1.5 rounded-lg border border-border/80 bg-card/90 px-2.5 py-1 text-xs shadow-xs"
                title={`${a.originalName} (${fmtSize(a.sizeBytes)})`}
              >
                <FileText className="size-3.5 text-indigo-500" />
                <span className="max-w-[160px] truncate font-medium">
                  {a.originalName}
                </span>
                <span className="text-[11px] text-muted-foreground">{fmtSize(a.sizeBytes)}</span>
                <button
                  type="button"
                  onClick={() => props.onRemoveAttachment(a.id)}
                  className="rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                  aria-label={`Hapus lampiran ${a.originalName}`}
                >
                  <X className="size-3" />
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="relative flex flex-col rounded-[24px] border border-border/80 bg-card/90 p-2 shadow-sm transition-all duration-200 focus-within:border-indigo-500/50 focus-within:ring-2 focus-within:ring-indigo-500/20">
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

          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            onCompositionStart={() => setImeComposing(true)}
            onCompositionEnd={() => setImeComposing(false)}
            placeholder="Tulis pesan…"
            aria-label="Pesan untuk AI"
            rows={1}
            disabled={props.disabled}
            className="max-h-44 min-h-[38px] w-full resize-none bg-transparent px-2 py-1.5 text-sm outline-none placeholder:text-muted-foreground/70 disabled:opacity-50"
          />

          <div className="mt-1 flex items-center justify-between pt-1">
            <div className="flex items-center gap-1">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button type="button" variant="ghost" size="icon" className="size-9 rounded-xl text-muted-foreground" aria-label="Lampiran, connector, dan izin" title="Lampiran, connector, dan izin">
                    {props.uploading ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-5" />}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" side="top" sideOffset={12} className="w-64 p-2">
                  <ConnectorSubmenu
                    connectors={connectors}
                    selectedId={selectedId}
                    onSelect={(id) => props.onSelectConnector?.(id)}
                    onAddRouter={() => props.onAddRouter?.()}
                    disabled={props.running}
                  />
                  <DropdownMenuItem onSelect={() => props.onAddRouter?.()} className="gap-3 px-2 py-2.5">
                    <Plus className="size-4" /> Tambah router
                  </DropdownMenuItem>
                  <DropdownMenuItem disabled={uploadDisabled} onSelect={() => pickFile(false)} className="gap-3 px-2 py-2.5"><FileText className="size-4" />Tambahkan file</DropdownMenuItem>
                  <DropdownMenuItem disabled={uploadDisabled} onSelect={() => pickFile(true)} className="gap-3 px-2 py-2.5"><ImagePlus className="size-4" />Tambahkan gambar</DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuCheckboxItem checked={writeEnabled} onCheckedChange={toggleWrite} onSelect={(event) => event.preventDefault()} disabled={!props.connector || props.connector.status !== "connected" || setMode.isPending || props.running} className="gap-2 px-2 py-2.5 [&_[data-slot=dropdown-menu-checkbox-item-indicator]]:hidden">
                    <ShieldCheck className="size-4" />
                    <span className="flex-1 text-xs">Izinkan perubahan</span>
                    <span aria-hidden="true" className={`flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition-colors ${writeEnabled ? "bg-amber-500" : "bg-muted-foreground/25"}`}><span className={`size-4 rounded-full bg-white shadow-sm transition-transform ${writeEnabled ? "translate-x-4" : "translate-x-0"}`} /></span>
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuItem onSelect={() => props.onCompact?.()} className="gap-3 px-2 py-2.5">
                    <Scissors className="size-4" /> Compact percakapan
                  </DropdownMenuItem>
                  <p className="px-2 pb-2 text-[11px] leading-relaxed text-muted-foreground">
                    {!props.connector ? "Belum terhubung — chat umum tetap berfungsi." : writeEnabled ? "Perubahan melalui transaksi Safe Mode." : "Read-only. Konfigurasi router tidak diubah."}
                  </p>
                </DropdownMenuContent>
              </DropdownMenu>
              {writeEnabled && <span className="rounded-md bg-amber-500/10 px-2 py-1 text-[10px] font-medium text-amber-600 dark:text-amber-400">Write aktif</span>}
              {!props.connector && <span className="rounded-md bg-muted px-2 py-1 text-[10px] text-muted-foreground">Belum terhubung</span>}
            </div>

            <div className="flex items-center gap-1.5 sm:gap-2">
              {availableModels.length > 0 && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className="flex h-8 items-center gap-1.5 rounded-lg border border-border/70 bg-muted/40 px-2 py-1 text-xs text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring transition-colors max-w-[170px]"
                      title={`${effectiveProvider?.name ?? ""} / ${effectiveModel}`}
                      aria-label="Pilih model AI"
                    >
                      <Sparkles className="size-3 text-indigo-500 shrink-0" />
                      <span className="truncate text-[11px] font-medium">{effectiveProvider?.name} / {effectiveModel || "Pilih model"}</span>
                      <ChevronDown className="size-3 text-muted-foreground shrink-0 opacity-70" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" side="top" sideOffset={8} className="w-64 max-h-72 overflow-y-auto p-1.5">
                    <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Pilih Model AI
                    </div>
                    {enabledProviders.map((p) => {
                      const pModels = p.models || [];
                      if (pModels.length === 0) return null;
                      return (
                        <div key={p.id} className="py-1">
                          <div className="px-2 py-0.5 text-[10px] font-semibold text-indigo-600 dark:text-indigo-400 flex items-center justify-between">
                            <span>{p.name}</span>
                            <span className="text-[9px] text-muted-foreground uppercase">{p.kind}</span>
                          </div>
                          {pModels.map((m) => {
                            const isSelected = m === effectiveModel && p.id === effectiveSelection?.providerId;
                            return (
                              <DropdownMenuItem
                                key={m}
                                onSelect={() => {
                                  const next = { providerId: p.id, model: m };
                                  setSelection(next);
                                  try {
                                    localStorage.setItem(SELECTION_KEY, JSON.stringify(next));
                                  } catch {
                                    /* ignore */
                                  }
                                }}
                                className={`flex items-center justify-between px-2 py-1.5 text-xs font-mono cursor-pointer rounded-md ${
                                  isSelected ? "bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 font-semibold" : ""
                                }`}
                              >
                                <div className="min-w-0"><span className="block truncate">{m}</span><ModelLimitIndicator data={p.modelLimits?.[m]} compact /></div>
                                {isSelected && <Check className="size-3.5 text-indigo-500 shrink-0 ml-1.5" />}
                              </DropdownMenuItem>
                            );
                          })}
                          <DropdownMenuSeparator />
                        </div>
                      );
                    })}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              <ContextMeter conversationId={props.conversationId} running={props.running} />
              <Button type="button" size="icon" className={`size-9 rounded-xl transition-colors ${props.running ? "bg-foreground text-background hover:bg-foreground/85" : "bg-indigo-600 text-white hover:bg-indigo-500"}`} onClick={props.running ? props.onCancel : submit} disabled={props.running ? props.cancelling : props.disabled || props.uploading || setMode.isPending || !text.trim()} aria-label={props.running ? "Hentikan jawaban" : setMode.isPending ? "Menunggu mode router…" : "Kirim pesan"} title={props.running ? "Hentikan jawaban" : setMode.isPending ? "Menunggu mode router…" : "Kirim pesan"}>
                {props.running ? <Square className="size-3.5 fill-current" /> : <Send className="size-4" />}
              </Button>
            </div>
          </div>
        </div>

        <div className="mt-1.5 flex items-center justify-between px-1 text-[11px] text-muted-foreground/80">
          <div className="flex items-center gap-1">
            <span>Tekan</span>
            <kbd className="rounded border border-border/80 bg-muted/60 px-1 py-0.2 font-mono text-[10px]">Enter</kbd>
            <span>untuk mengirim,</span>
            <kbd className="rounded border border-border/80 bg-muted/60 px-1 py-0.2 font-mono text-[10px]">Shift+Enter</kbd>
            <span>baris baru</span>
          </div>
          <span className="hidden sm:inline">MikroTik Safe Mode Protected</span>
        </div>
      </div>
    </div>
  );
}

export function toastAttachmentError(msg: string) {
  toast.error(msg);
}
