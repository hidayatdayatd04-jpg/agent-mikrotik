import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, Plus, Send, X, Square, FileText, ImagePlus, ShieldCheck, ChevronDown, Check, Scissors, Settings2, Search } from "@/components/icons";
import { toast } from "sonner";
import { navigate } from "@/lib/router";
import type { AttachmentDTO } from "./chat-hooks";
import { fmtSize } from "./ChatPanel";
import type { ConnectorDTO } from "@shared/index";
import { useConnectors, useSetConnectorMode, useWriteReadiness } from "@/features/connectors/connector-hooks";
import { ContextMeter } from "./ContextMeter";
import { ConnectorPicker } from "./ConnectorPicker";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuCheckboxItem } from "@/components/ui/dropdown-menu";
import { useAiProviders } from "./chat-hooks";
import { readProviderSelection, resolveProviderSelection, SELECTION_KEY } from "./provider-selection";
import { ModelLimitIndicator } from "./ModelLimitIndicator";
import { ProviderLogo, providerLogoId } from "./provider-logos";

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
  const [modelQuery, setModelQuery] = useState("");
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const effectiveSelection = resolveProviderSelection(aiProviders.data ?? [], selection);
  const effectiveModel = effectiveSelection?.model ?? "";
  const effectiveProvider = enabledProviders.find((p) => p.id === effectiveSelection?.providerId);

  // Sembuhkan pilihan basi (provider dinonaktifkan / model dihapus) agar trigger,
  // context meter, dan run selalu memakai model yang sama.
  useEffect(() => {
    if (aiProviders.data === undefined || !effectiveSelection) return;
    if (selection?.providerId !== effectiveSelection.providerId || selection?.model !== effectiveSelection.model) {
      setSelection(effectiveSelection);
      try {
        localStorage.setItem(SELECTION_KEY, JSON.stringify(effectiveSelection));
      } catch {
        /* ignore */
      }
    }
  }, [aiProviders.data, effectiveSelection, selection]);

  function goManageModels() {
    try {
      if (props.draftKey) localStorage.setItem(props.draftKey, text);
      sessionStorage.setItem("composer-draft", text);
    } catch {
      /* ignore */
    }
    navigate({ name: "settings", section: "providers" });
  }

  // Scrollbar custom dari nol: scrollbar bawaan browser dimatikan total
  // (tidak ada panah atas-bawah), thumb digambar & diseret manual.
  const modelScrollRef = useRef<HTMLDivElement>(null);
  const modelTrackRef = useRef<HTMLDivElement>(null);
  const modelDragRef = useRef<{ startY: number; startTop: number } | null>(null);
  const [modelThumb, setModelThumb] = useState({ top: 0, height: 0, visible: false });

  const updateModelThumb = useCallback(() => {
    const el = modelScrollRef.current;
    const track = modelTrackRef.current;
    if (!el || !track) return;
    const { scrollTop, scrollHeight, clientHeight } = el;
    const trackH = track.clientHeight;
    if (scrollHeight <= clientHeight + 1 || trackH <= 0) {
      setModelThumb((t) => (t.visible ? { ...t, visible: false } : t));
      return;
    }
    const height = Math.max(24, (clientHeight / scrollHeight) * trackH);
    const maxTop = Math.max(1, trackH - height);
    const top = Math.min(maxTop, (scrollTop / (scrollHeight - clientHeight)) * maxTop);
    setModelThumb({ top, height, visible: true });
  }, []);

  useEffect(() => {
    if (!modelMenuOpen) return;
    const raf = requestAnimationFrame(updateModelThumb);
    window.addEventListener("resize", updateModelThumb);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", updateModelThumb);
    };
  }, [modelMenuOpen, modelQuery, aiProviders.data, updateModelThumb]);

  function onModelThumbPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    e.stopPropagation();
    e.preventDefault();
    const el = modelScrollRef.current;
    const track = modelTrackRef.current;
    if (!el || !track) return;
    const trackH = track.clientHeight;
    const height = Math.max(24, (el.clientHeight / el.scrollHeight) * trackH);
    const maxTop = Math.max(1, trackH - height);
    modelDragRef.current = { startY: e.clientY, startTop: el.scrollTop };
    const move = (ev: PointerEvent) => {
      const d = modelDragRef.current;
      if (!d) return;
      el.scrollTop = d.startTop + ((ev.clientY - d.startY) / maxTop) * (el.scrollHeight - el.clientHeight);
    };
    const up = () => {
      modelDragRef.current = null;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  function onModelTrackPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    const el = modelScrollRef.current;
    const track = modelTrackRef.current;
    if (!el || !track) return;
    const rect = track.getBoundingClientRect();
    if (rect.height <= 0) return;
    el.scrollTop = ((e.clientY - rect.top) / rect.height) * (el.scrollHeight - el.clientHeight);
  }

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

  const fallbackConnectors = useConnectors();
  const connectors = (props.connectors && props.connectors.length > 0)
    ? props.connectors
    : (fallbackConnectors.data ?? (props.connector ? [props.connector] : []));
  const selectedId = props.selectedConnectorId ?? props.connector?.id ?? null;

  const isDocked = Boolean(props.conversationId);
  return (
    <div className={isDocked ? "border-t border-border/40 bg-background/80 backdrop-blur-md px-3 py-3 sm:px-6 sm:py-4" : "w-full"}>
      <div className={isDocked ? "mx-auto max-w-3xl" : "w-full"}>
        {props.attachments.length > 0 && (
          <div className="mb-2.5 flex flex-wrap gap-2">
            {props.attachments.map((a) => (
              <span
                key={a.id}
                className="flex items-center gap-1.5 rounded-xl border border-border/80 bg-card/90 px-2.5 py-1 text-xs shadow-xs"
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
                  className="rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors cursor-pointer"
                  aria-label={`Hapus lampiran ${a.originalName}`}
                >
                  <X className="size-3" />
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="relative flex flex-col rounded-2xl border border-border/70 bg-card/95 p-2 shadow-sm transition-colors duration-200 hover:border-border">
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
            <div className="flex items-center gap-1.5 flex-wrap">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button type="button" variant="ghost" size="icon" className="size-9 rounded-xl text-muted-foreground hover:bg-accent hover:text-foreground transition-all cursor-pointer" aria-label="Lampiran, connector, izin, dan Tambah router" title="Lampiran, connector, izin, dan Tambah router">
                    {props.uploading ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-5" />}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" side="top" sideOffset={12} className="w-84 max-w-[calc(100vw-2rem)] rounded-2xl border border-border/60 bg-popover/95 p-2 shadow-xl backdrop-blur-md">
                  <ConnectorPicker
                    connectors={connectors}
                    selectedId={selectedId}
                    onSelect={(id) => props.onSelectConnector?.(id)}
                    onAddRouter={() => props.onAddRouter?.()}
                    disabled={props.running}
                  />
                  <DropdownMenuItem disabled={uploadDisabled} onSelect={() => pickFile(false)} className="gap-3 px-2.5 py-2 text-xs font-medium rounded-xl cursor-pointer"><FileText className="size-4 text-muted-foreground" />Tambahkan file</DropdownMenuItem>
                  <DropdownMenuItem disabled={uploadDisabled} onSelect={() => pickFile(true)} className="gap-3 px-2.5 py-2 text-xs font-medium rounded-xl cursor-pointer"><ImagePlus className="size-4 text-muted-foreground" />Tambahkan gambar</DropdownMenuItem>
                  <DropdownMenuSeparator className="my-1" />
                  <DropdownMenuCheckboxItem checked={writeEnabled} onCheckedChange={toggleWrite} onSelect={(event) => event.preventDefault()} disabled={!props.connector || props.connector.status !== "connected" || setMode.isPending || props.running} className="gap-2 px-2.5 py-2 text-xs font-medium rounded-xl cursor-pointer [&_[data-slot=dropdown-menu-checkbox-item-indicator]]:hidden">
                    <ShieldCheck className="size-4 text-amber-500" />
                    <span className="flex-1 text-xs">Izinkan perubahan</span>
                    <span aria-hidden="true" className={`flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition-colors ${writeEnabled ? "bg-amber-500" : "bg-muted-foreground/25"}`}><span className={`size-4 rounded-full bg-white shadow-sm transition-transform ${writeEnabled ? "translate-x-4" : "translate-x-0"}`} /></span>
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuItem onSelect={() => props.onCompact?.()} className="gap-3 px-2.5 py-2 text-xs font-medium rounded-xl cursor-pointer">
                    <Scissors className="size-4 text-muted-foreground" /> Compact percakapan
                  </DropdownMenuItem>
                  <p className="px-2 pt-1 pb-1 text-[11px] leading-relaxed text-muted-foreground/80">
                    {!props.connector ? "Belum terhubung — chat umum tetap berfungsi." : writeEnabled ? "Perubahan melalui transaksi Safe Mode." : "Read-only. Konfigurasi router tidak diubah."}
                  </p>
                </DropdownMenuContent>
              </DropdownMenu>

              {props.connector && (
                <span
                  className="hidden sm:inline-flex items-center gap-1.5 rounded-lg bg-muted/60 border border-border/50 px-2 py-1 text-[11px] text-foreground max-w-[140px] truncate"
                  title={`${props.connector.label} (${props.connector.host})`}
                >
                  <span className={`size-1.5 rounded-full shrink-0 ${props.connector.status === "connected" ? "bg-emerald-500" : "bg-muted-foreground/40"}`} />
                  <span className="truncate font-medium">{props.connector.label}</span>
                </span>
              )}

              {props.connector && writeEnabled && (
                <span className="inline-flex items-center gap-1 rounded-lg bg-amber-500/10 border border-amber-500/20 px-2 py-1 text-[10px] font-semibold text-amber-600 dark:text-amber-400" title="Mode Write aktif: Perubahan diizinkan dalam Safe Mode">
                  <ShieldCheck className="size-3 text-amber-500 shrink-0" />
                  <span>Write aktif</span>
                </span>
              )}

              {props.connector && !writeEnabled && (
                <span className="inline-flex items-center gap-1 rounded-lg bg-sky-500/10 border border-sky-500/20 px-2 py-1 text-[10px] font-semibold text-sky-600 dark:text-sky-400" title="Mode Read-Only: Konfigurasi router aman dan tidak diubah">
                  <ShieldCheck className="size-3 text-sky-500 shrink-0" />
                  <span>Read-Only</span>
                </span>
              )}

              {!props.connector && (
                <span className="rounded-lg bg-muted px-2 py-1 text-[10px] font-medium text-muted-foreground">
                  Belum terhubung
                </span>
              )}
            </div>

            <div className="flex items-center gap-1.5 sm:gap-2">
              {availableModels.length > 0 && (
                <DropdownMenu onOpenChange={(open) => { setModelMenuOpen(open); if (!open) setModelQuery(""); }}>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className="flex h-8 items-center gap-1.5 rounded-xl border border-border/70 bg-muted/40 px-2.5 py-1 text-xs text-foreground hover:bg-muted focus-visible:outline-none transition-colors max-w-[190px] cursor-pointer"
                      title={`${effectiveProvider?.name ?? ""} / ${effectiveModel}`}
                      aria-label="Pilih model AI"
                    >
                      <ProviderLogo
                        logoId={providerLogoId({ kind: effectiveProvider?.kind, id: effectiveProvider?.id, name: effectiveProvider?.name })}
                        alt={effectiveProvider?.name ?? "model"}
                      />
                      <span className="truncate text-[11px] font-medium">{effectiveProvider?.name} / {effectiveModel || "Pilih model"}</span>
                      <ChevronDown className="size-3 text-muted-foreground shrink-0 opacity-70" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" side="top" sideOffset={8} className="w-80 overflow-hidden rounded-2xl border border-border/60 bg-popover bg-clip-padding p-0 shadow-xl ring-0">
                    <div className="p-2 pb-1.5">
                      <div className="relative">
                        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/70" />
                        <input
                          value={modelQuery}
                          onChange={(e) => setModelQuery(e.target.value)}
                          onKeyDown={(e) => { if (e.key !== "Escape") e.stopPropagation(); }}
                          placeholder="Search models"
                          aria-label="Cari model"
                          className="h-9 w-full rounded-xl bg-muted/50 pl-8.5 pr-2 text-xs outline-none placeholder:text-muted-foreground/60 transition-colors"
                        />
                      </div>
                    </div>
                    <div className="relative px-1">
                      <div
                        ref={modelScrollRef}
                        onScroll={updateModelThumb}
                        className="max-h-56 overflow-y-auto pl-1 pr-3 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                      >
                    {(() => {
                      const mq = modelQuery.trim().toLowerCase();
                      const groups = enabledProviders
                        .map((p) => ({ p, models: mq ? (p.models || []).filter((m) => m.toLowerCase().includes(mq)) : (p.models || []) }))
                        .filter((g) => g.models.length > 0);
                      if (groups.length === 0) {
                        return <p className="px-2.5 py-4 text-center text-xs text-muted-foreground">Tidak ada model yang cocok.</p>;
                      }
                      return groups.map(({ p, models }) => {
                        const providerLogo = providerLogoId(p);
                        return (
                          <div key={p.id} className="mt-2.5 first:mt-1">
                            <div className="flex items-center gap-2 px-2.5 pt-1 pb-2">
                              <ProviderLogo logoId={providerLogo} alt={p.name} />
                              <span className="truncate text-[11px] font-semibold tracking-wide text-muted-foreground">{p.name}</span>
                              <span className="ml-auto shrink-0 rounded-full bg-muted px-1.5 py-0.5 font-mono text-[10px] font-medium text-muted-foreground">{models.length}</span>
                            </div>
                            {models.map((m) => {
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
                                  className={`group mt-1 flex items-center justify-between gap-2 rounded-xl px-2.5 py-2.5 text-[13px] transition-colors cursor-pointer select-none ${
                                    isSelected
                                      ? "bg-indigo-500/10 font-medium text-indigo-600 dark:text-indigo-400"
                                      : "text-foreground/90 hover:bg-muted"
                                  }`}
                                >
                                  <span className="flex min-w-0 flex-1 items-center gap-2">
                                    <span className="truncate">{m}</span>
                                  </span>
                                  <span className="flex shrink-0 items-center gap-1.5">
                                    <ModelLimitIndicator data={p.modelLimits?.[m]} compact />
                                    {isSelected && <Check className="size-4 shrink-0" />}
                                  </span>
                                </DropdownMenuItem>
                              );
                            })}
                          </div>
                        );
                      });
                    })()}
                      </div>
                      <div
                        ref={modelTrackRef}
                        onPointerDown={onModelTrackPointerDown}
                        className={`absolute right-0.5 top-1 bottom-1 flex w-2 justify-center rounded-full ${modelThumb.visible ? "cursor-pointer" : "pointer-events-none"}`}
                        aria-hidden="true"
                      >
                        {modelThumb.visible && (
                          <div
                            onPointerDown={onModelThumbPointerDown}
                            style={{ top: modelThumb.top, height: modelThumb.height }}
                            className="absolute w-1 rounded-full bg-foreground/15 transition-colors hover:bg-foreground/30"
                          />
                        )}
                      </div>
                    </div>
                    <div className="border-t border-border/60 p-1.5">
                      <DropdownMenuItem
                        onSelect={goManageModels}
                        className="group flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-sm cursor-pointer select-none text-foreground/90 hover:bg-muted"
                      >
                        <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-indigo-500/10">
                          <Settings2 className="size-4 text-indigo-600 dark:text-indigo-400" />
                        </span>
                        <span className="font-medium">Manage models</span>
                      </DropdownMenuItem>
                    </div>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              <ContextMeter conversationId={props.conversationId} running={props.running} providerId={effectiveSelection?.providerId ?? null} model={effectiveModel || undefined} providerName={effectiveProvider?.name} />
              <Button type="button" size="icon" className={`size-9 rounded-xl transition-colors ${props.running ? "bg-foreground text-background hover:bg-foreground/85" : "bg-indigo-600 text-white hover:bg-indigo-500"}`} onClick={props.running ? props.onCancel : submit} disabled={props.running ? props.cancelling : props.disabled || props.uploading || setMode.isPending || !text.trim()} aria-label={props.running ? "Hentikan jawaban" : setMode.isPending ? "Menunggu mode router…" : "Kirim pesan"} title={props.running ? "Hentikan jawaban" : setMode.isPending ? "Menunggu mode router…" : "Kirim pesan"}>
                {props.running ? <Square className="size-3.5 fill-current" /> : <Send className="size-4" />}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function toastAttachmentError(msg: string) {
  toast.error(msg);
}
