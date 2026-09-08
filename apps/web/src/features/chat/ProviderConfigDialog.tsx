import { useState, useEffect } from "react";
import { ModelLimitIndicator } from "./ModelLimitIndicator";
import { useAiProviders } from "./chat-hooks";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  Eye,
  EyeOff,
  Plus,
  Trash2,
  RefreshCw,
  CheckCircle2,
  Lock,
  Loader2,
} from "@/components/icons";
import { useSaveAiProvider, useDeleteAiProvider, fetchProviderModels } from "./chat-hooks";
import { ProviderLogo, providerLogoId } from "./provider-logos";

export interface ProviderConfigDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  provider: {
    id?: string;
    kind: "gemini" | "openrouter" | "custom";
    name: string;
    baseUrl?: string;
    models?: string[];
    activeModel?: string;
    hasKey?: boolean;
    enabled?: boolean;
  } | null;
  isNew?: boolean;
}

const PRESET_RECOMMENDATIONS: Record<string, string[]> = {
  gemini: ["gemini-2.0-flash", "gemini-1.5-flash", "gemini-1.5-pro", "gemini-2.5-flash"],
  openrouter: [
    "anthropic/claude-3.5-sonnet",
    "deepseek/deepseek-chat",
    "meta-llama/llama-3.3-70b-instruct",
    "google/gemini-2.0-flash-001",
    "openai/gpt-4o-mini",
  ],
  custom: ["llama3.2:latest", "mistral:latest", "qwen2.5:latest"],
};

export function ProviderConfigDialog({
  open,
  onOpenChange,
  provider,
  isNew = false,
}: ProviderConfigDialogProps) {
  const saveProvider = useSaveAiProvider();
  const deleteProvider = useDeleteAiProvider();

  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [activeModel, setActiveModel] = useState<string>("");
  const [newModelInput, setNewModelInput] = useState("");
  const [fetchingRemote, setFetchingRemote] = useState(false);
  const [remoteModels, setRemoteModels] = useState<{ id: string; label?: string }[] | null>(null);

  // Sync state when dialog opens or provider changes
  useEffect(() => {
    if (provider) {
      setName(provider.name || "");
      setBaseUrl(
        provider.baseUrl ||
          (provider.kind === "gemini"
            ? "https://generativelanguage.googleapis.com/v1beta/openai/v1"
            : provider.kind === "openrouter"
            ? "https://openrouter.ai/api/v1"
            : "")
      );
      setApiKey("");
      setShowKey(false);
      const initialModels =
        provider.models && provider.models.length > 0
          ? [...provider.models]
          : PRESET_RECOMMENDATIONS[provider.kind]?.slice(0, 1) ?? [];
      setModels(initialModels);
      setActiveModel(provider.activeModel || initialModels[0] || "");
      setNewModelInput("");
      setRemoteModels(null);
    }
  }, [provider, open]);

  const liveProviders = useAiProviders();
  if (!provider) return null;

  const currentProvider = provider;
  const kind = currentProvider.kind;
  const hasSavedKey = currentProvider.hasKey;

  function handleAddModel(modelToAdd: string) {
    const trimmed = modelToAdd.trim();
    if (!trimmed) return;
    if (models.includes(trimmed)) {
      toast.info(`Model "${trimmed}" sudah ada di daftar.`);
      return;
    }
    const updated = [...models, trimmed];
    setModels(updated);
    if (!activeModel) {
      setActiveModel(trimmed);
    }
    setNewModelInput("");
  }

  function handleRemoveModel(modelToRemove: string) {
    const updated = models.filter((m) => m !== modelToRemove);
    setModels(updated);
    if (activeModel === modelToRemove) {
      setActiveModel(updated[0] || "");
    }
  }

  async function handleFetchRemoteModels() {
    if (!apiKey && !hasSavedKey) {
      toast.error("Isi API key terlebih dahulu untuk mengambil daftar model.");
      return;
    }
    if (kind === "custom" && !baseUrl.trim()) {
      toast.error("Isi Base URL terlebih dahulu untuk provider Custom.");
      return;
    }

    setFetchingRemote(true);
    try {
      const res = await fetchProviderModels({
        providerId: currentProvider.id,
        kind,
        baseUrl: baseUrl.trim() || undefined,
        apiKey: apiKey || undefined,
      });
      setRemoteModels(res.models);
      if (res.models.length === 0) {
        toast.info("Provider tidak mengembalikan daftar model otomatis. Anda dapat mengetik manual.");
      } else {
        toast.success(`${res.models.length} model ditemukan dari provider.`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal mengambil daftar model.");
    } finally {
      setFetchingRemote(false);
    }
  }

  function handleSave() {
    if (models.length === 0) {
      toast.error("Tambahkan minimal 1 model untuk provider ini.");
      return;
    }
    const resolvedActive = activeModel || models[0] || "";
    if (!resolvedActive) {
      toast.error("Pilih model aktif untuk provider ini.");
      return;
    }
    if (!hasSavedKey && !apiKey.trim()) {
      toast.error("API Key wajib diisi untuk provider baru.");
      return;
    }

    const providerId = currentProvider.id || (kind === "custom" ? undefined : kind);

    saveProvider.mutate(
      {
        id: providerId,
        kind,
        name: name.trim() || currentProvider.name,
        baseUrl: baseUrl.trim(),
        apiKey: apiKey.trim() || undefined,
        models,
        activeModel: resolvedActive,
        enabled: currentProvider.enabled ?? true,
      },
      {
        onSuccess: () => {
          toast.success(`Konfigurasi provider ${name || currentProvider.name} berhasil disimpan.`);
          onOpenChange(false);
        },
        onError: (err) => {
          toast.error(err.message);
        },
      }
    );
  }

  function handleDelete() {
    if (!currentProvider.id) return;
    if (confirm(`Apakah Anda yakin ingin menghapus konfigurasi provider ${currentProvider.name}?`)) {
      deleteProvider.mutate(currentProvider.id, {
        onSuccess: () => {
          toast.success(`Provider ${currentProvider.name} berhasil dihapus.`);
          onOpenChange(false);
        },
        onError: (err) => {
          toast.error(err.message);
        },
      });
    }
  }

  const recommendations = PRESET_RECOMMENDATIONS[kind] || [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto sm:p-6">
        <DialogHeader>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-indigo-500">
            <ProviderLogo
              logoId={providerLogoId({ kind, id: currentProvider.id, name: name || currentProvider.name })}
              alt={name || currentProvider.name}
            />
            {isNew ? "Tambah Provider Baru" : "Pengaturan Provider AI"}
          </div>
          <DialogTitle className="text-xl font-bold tracking-tight">
            {name || currentProvider.name}
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Kelola endpoint URL, API Key, dan multi-model untuk provider ini. Data disimpan aman
            dalam database terpisah.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {/* Provider Name */}
          <div className="space-y-1.5">
            <Label htmlFor="provider-name" className="text-xs font-semibold">
              Nama Provider
            </Label>
            <Input
              id="provider-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Contoh: Google Gemini Pro"
              className="h-9 text-sm"
            />
          </div>

          {/* Base URL */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="provider-base-url" className="text-xs font-semibold">
                Base URL (OpenAI-compatible)
              </Label>
              {kind === "gemini" && (
                <span className="text-[11px] text-muted-foreground">Endpoint resmi Gemini v1beta</span>
              )}
              {kind === "openrouter" && (
                <span className="text-[11px] text-muted-foreground">openrouter.ai/api/v1</span>
              )}
            </div>
            <Input
              id="provider-base-url"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://..."
              className="h-9 font-mono text-xs"
            />
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              {kind === "custom"
                ? "Gunakan URL server LLM lokal (misal Ollama: http://localhost:11434/v1) atau OpenAI endpoint."
                : "Biarkan default kecuali Anda menggunakan custom proxy atau routing khusus."}
            </p>
          </div>

          {/* API Key */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="provider-api-key" className="text-xs font-semibold">
                API Key
              </Label>
              {hasSavedKey && (
                <span className="flex items-center gap-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                  <Lock className="size-3" />
                  Kunci Tersimpan (AES-256)
                </span>
              )}
            </div>
            <div className="relative">
              <Input
                id="provider-api-key"
                type={showKey ? "text" : "password"}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={
                  hasSavedKey
                    ? "•••••••••••••••• (Kosongkan jika tidak ingin mengubah)"
                    : "Masukkan API key..."
                }
                className="h-9 pr-10 font-mono text-xs"
              />
              <button
                type="button"
                onClick={() => setShowKey(!showKey)}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
                aria-label={showKey ? "Sembunyikan API key" : "Tampilkan API key"}
              >
                {showKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Disimpan terenkripsi dengan AES-256-GCM. Tidak pernah diekspos ke browser setelah disimpan.
            </p>
          </div>

          {/* Multi-Model Management Section */}
          <div className="rounded-xl border border-border/70 bg-muted/20 p-4 space-y-3.5">
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-xs font-semibold flex items-center gap-1.5">
                  Kelola Daftar Model ({models.length})
                </Label>
                <p className="text-[11px] text-muted-foreground">
                  Tambahkan lebih dari satu model. Model ini akan muncul di pilihan chat.
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleFetchRemoteModels}
                disabled={fetchingRemote || (!apiKey && !hasSavedKey)}
                className="h-8 gap-1.5 text-xs"
              >
                {fetchingRemote ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="size-3.5" />
                )}
                Tarik Model
              </Button>
            </div>

            {/* Recommendations Quick Chips */}
            {recommendations.length > 0 && (
              <div className="space-y-1.5">
                <span className="text-[11px] font-medium text-muted-foreground">
                  Rekomendasi Cepat:
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {recommendations.map((rec) => {
                    const alreadyAdded = models.includes(rec);
                    return (
                      <button
                        key={rec}
                        type="button"
                        onClick={() => handleAddModel(rec)}
                        disabled={alreadyAdded}
                        className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs transition-colors ${
                          alreadyAdded
                            ? "border-border/40 bg-muted/40 text-muted-foreground/60 cursor-default"
                            : "border-indigo-500/30 bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-500/20"
                        }`}
                      >
                        <Plus className="size-2.5" />
                        {rec}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Remote Models Picker if fetched */}
            {remoteModels && remoteModels.length > 0 && (
              <div className="rounded-lg border border-border/60 bg-card p-3 space-y-2">
                <span className="text-xs font-semibold flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="size-3.5" />
                  Ditemukan {remoteModels.length} Model dari Provider (Klik untuk menambahkan):
                </span>
                <div className="max-h-36 overflow-y-auto space-y-1 pr-1">
                  {remoteModels.map((m) => {
                    const alreadyAdded = models.includes(m.id);
                    return (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => handleAddModel(m.id)}
                        disabled={alreadyAdded}
                        className={`w-full flex items-center justify-between rounded px-2 py-1 text-xs text-left transition-colors ${
                          alreadyAdded
                            ? "bg-muted/40 text-muted-foreground cursor-default"
                            : "hover:bg-indigo-500/10 text-foreground"
                        }`}
                      >
                        <span className="font-mono text-[11px] truncate">{m.id}</span>
                        {alreadyAdded ? (
                          <span className="text-[10px] text-muted-foreground">Sudah ada</span>
                        ) : (
                          <span className="text-[10px] text-indigo-500 font-medium">+ Tambah</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Configured Models List */}
            <div className="space-y-2">
              <span className="text-xs font-semibold">Model Terdaftar:</span>
              {models.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border/80 p-3 text-center text-xs text-muted-foreground">
                  Belum ada model yang ditambahkan. Gunakan rekomendasi di atas atau masukkan manual.
                </p>
              ) : (
                <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                  {models.map((m) => {
                    const isActive = activeModel === m;
                    return (
                      <div
                        key={m}
                        className={`flex items-center justify-between rounded-lg border px-3 py-2 text-xs transition-colors ${
                          isActive
                            ? "border-indigo-500/60 bg-indigo-500/[0.08]"
                            : "border-border/70 bg-card hover:border-border"
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => setActiveModel(m)}
                          className="flex items-center gap-2 text-left flex-1 min-w-0"
                          title="Klik untuk jadikan model aktif default"
                        >
                          <div
                            className={`size-3.5 rounded-full border flex items-center justify-center shrink-0 ${
                              isActive
                                ? "border-indigo-500 bg-indigo-500"
                                : "border-muted-foreground/50"
                            }`}
                          >
                            {isActive && <div className="size-1.5 rounded-full bg-white" />}
                          </div>
                          <div className="min-w-0 flex-1">
                            <span className="font-mono font-medium break-all">{m}</span>
                            <ModelLimitIndicator data={liveProviders.data?.find((p) => p.id === currentProvider.id)?.modelLimits?.[m]} />
                          </div>
                          {isActive && (
                            <span className="rounded bg-indigo-500/20 px-1.5 py-0.2 text-[10px] font-semibold text-indigo-600 dark:text-indigo-400">
                              Model Aktif
                            </span>
                          )}
                        </button>

                        <button
                          type="button"
                          onClick={() => handleRemoveModel(m)}
                          className="ml-2 rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
                          title={`Hapus model ${m}`}
                          aria-label={`Hapus model ${m}`}
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Manual Add Model */}
            <div className="flex items-center gap-2 pt-1">
              <Input
                value={newModelInput}
                onChange={(e) => setNewModelInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleAddModel(newModelInput);
                  }
                }}
                placeholder="Tambah model manual (misal: gpt-4o, claude-3-haiku)..."
                className="h-8 text-xs font-mono"
              />
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => handleAddModel(newModelInput)}
                disabled={!newModelInput.trim()}
                className="h-8 shrink-0 text-xs gap-1"
              >
                <Plus className="size-3.5" />
                Tambah
              </Button>
            </div>
          </div>
        </div>

        <DialogFooter className="flex items-center justify-between sm:justify-between pt-2 border-t border-border/60">
          <div>
            {!isNew && (currentProvider.id === "custom" || currentProvider.id?.startsWith("custom-")) && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleDelete}
                className="text-xs text-destructive hover:bg-destructive/10"
              >
                <Trash2 className="size-3.5 mr-1" />
                Hapus Provider
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
              className="text-xs"
            >
              Batal
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleSave}
              disabled={saveProvider.isPending}
              className="text-xs bg-indigo-600 hover:bg-indigo-500 text-white gap-1.5"
            >
              {saveProvider.isPending && <Loader2 className="size-3.5 animate-spin" />}
              Simpan Konfigurasi
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
