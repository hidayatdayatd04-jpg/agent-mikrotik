import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Loader2, RefreshCw, Trash2 } from "lucide-react";
import {
  useProviderSettings,
  useSaveProviderSettings,
  useDeleteProviderSettings,
  fetchProviderModels,
} from "./chat-hooks";

const KINDS = [
  { id: "gemini", label: "Google Gemini", hint: "Endpoint OpenAI-compatible resmi Google" },
  { id: "openrouter", label: "OpenRouter", hint: "Banyak model dalam satu API" },
  { id: "custom", label: "Custom", hint: "ApiKey + BaseURL + model manual (OpenAI-compatible)" },
] as const;

/**
 * AI provider settings (M9, revisi user): Gemini / OpenRouter / Custom with
 * AUTO-FETCH model list — when the key (+baseUrl) is filled, the backend
 * proxies the provider's model list so the browser never holds key material;
 * manual model input stays available.
 */
export function ProviderSettingsPage() {
  const existing = useProviderSettings();
  const save = useSaveProviderSettings();
  const remove = useDeleteProviderSettings();

  const [kind, setKind] = useState<string>("gemini");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [models, setModels] = useState<{ id: string; label?: string }[] | null>(null);
  const [fetching, setFetching] = useState(false);

  // prefill from the saved settings (never the key itself)
  useEffect(() => {
    if (existing.data) {
      setKind(existing.data.kind);
      setBaseUrl(existing.data.baseUrl ?? "");
      setModel(existing.data.model ?? "");
      setApiKey("");
      setModels(null);
    }
  }, [existing.data]);

  const needsBaseUrl = kind === "custom";

  async function handleFetchModels() {
    if (!apiKey || apiKey.length < 8) {
      toast.error("Isi API key dulu untuk mengambil daftar model (minimal 8 karakter).");
      return;
    }
    if (needsBaseUrl && !baseUrl) {
      toast.error("Provider Custom wajib mengisi Base URL.");
      return;
    }
    setFetching(true);
    setModels(null);
    try {
      const res = await fetchProviderModels({ kind, baseUrl: needsBaseUrl ? baseUrl : undefined, apiKey });
      setModels(res.models);
      if (res.models.length === 0) toast.info("Provider tidak mengembalikan model apa pun.");
      else toast.success(`${res.models.length} model ditemukan — pilih satu atau tulis manual.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal mengambil daftar model.");
    } finally {
      setFetching(false);
    }
  }

  function handleSave() {
    if (!model.trim()) {
      toast.error("Pilih atau tulis nama model.");
      return;
    }
    const input: { kind: string; baseUrl?: string; model: string; apiKey?: string } = {
      kind,
      model: model.trim(),
    };
    if (needsBaseUrl) input.baseUrl = baseUrl.trim();
    if (apiKey) input.apiKey = apiKey;
    else if (!existing.data?.hasKey) {
      toast.error("API key wajib diisi untuk provider baru.");
      return;
    }
    save.mutate(input, {
      onSuccess: () => toast.success("Pengaturan provider AI tersimpan."),
      onError: (err) => toast.error(err.message),
    });
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-4 sm:p-6">
      <div>
        <h2 className="text-lg font-semibold">Provider AI</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Pilih penyedia model AI. API key disimpan terenkripsi di server dan tidak pernah dikembalikan ke browser.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {KINDS.map((k) => (
          <button
            key={k.id}
            type="button"
            onClick={() => {
              setKind(k.id);
              setModels(null);
              if (k.id === "custom") setBaseUrl("");
              else setBaseUrl(k.id === "gemini" ? "https://generativelanguage.googleapis.com/v1beta/openai/v1" : "https://openrouter.ai/api/v1");
            }}
            className={`rounded-xl border p-3 text-left transition-colors ${
              kind === k.id ? "border-ring bg-muted/60" : "hover:bg-muted/40"
            }`}
            aria-pressed={kind === k.id}
          >
            <span className="block text-sm font-medium">{k.label}</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">{k.hint}</span>
          </button>
        ))}
      </div>

      <div className="space-y-4 rounded-xl border p-4">
        <div className="space-y-2">
          <Label htmlFor="pv-baseurl">Base URL {needsBaseUrl ? "(wajib)" : "(opsional — default otomatis)"}</Label>
          <Input
            id="pv-baseurl"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder={kind === "gemini" ? "https://generativelanguage.googleapis.com/v1beta/openai/v1" : "https://…/v1"}
            className="font-mono text-xs"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="pv-key">
            API Key {existing.data?.hasKey ? "(tersimpan — isi ulang untuk mengganti)" : ""}
          </Label>
          <Input
            id="pv-key"
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={existing.data?.hasKey ? "•••••••• (tidak diubah)" : "tempel API key di sini"}
            autoComplete="off"
          />
          <p className="text-xs text-muted-foreground">
            Key dipakai untuk auto-fetch model dan request chat; disegel AES-256-GCM di server.
          </p>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="pv-model">Model</Label>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleFetchModels}
              disabled={fetching}
              className="gap-1.5"
            >
              {fetching ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <RefreshCw className="size-3.5" aria-hidden />}
              {fetching ? "Mengambil…" : "Ambil daftar model"}
            </Button>
          </div>
          <Input
            id="pv-model"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="contoh: gemini-2.0-flash / openai/gpt-4o-mini / model custom"
            className="font-mono text-xs"
          />
          {models && models.length > 0 && (
            <div className="max-h-56 space-y-1 overflow-y-auto rounded-lg border p-1">
              {models.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setModel(m.id)}
                  className={`flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left text-xs transition-colors ${
                    model === m.id ? "bg-primary text-primary-foreground" : "hover:bg-muted"
                  }`}
                >
                  <span className="font-mono">{m.id}</span>
                  {m.label && <span className="ml-2 truncate text-[11px] opacity-70">{m.label}</span>}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between pt-2">
          <Button onClick={handleSave} disabled={save.isPending} className="gap-2">
            {save.isPending && <Loader2 className="size-4 animate-spin" aria-hidden />}
            Simpan Pengaturan
          </Button>
          {existing.data?.hasKey && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() =>
                remove.mutate(undefined, {
                  onSuccess: () => {
                    toast.success("Provider AI dihapus — chat kembali memakai provider mock.");
                    setApiKey("");
                    setModel("");
                    setModels(null);
                  },
                  onError: (err) => toast.error(err.message),
                })
              }
              className="gap-1.5 text-destructive"
            >
              <Trash2 className="size-3.5" aria-hidden />
              Hapus
            </Button>
          )}
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Tanpa pengaturan tersimpan, chat memakai provider mock deterministik di server (untuk development).
        Saat pengaturan aktif, semua request chat memakai provider dan model pilihan Anda.
      </p>
    </div>
  );
}
