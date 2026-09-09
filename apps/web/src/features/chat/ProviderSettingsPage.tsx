import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Loader2, Trash2 } from "@/components/icons";
import { useProviderSettings, useSaveProviderSettings, useDeleteProviderSettings, useRateLimitStatus } from "./chat-hooks";
import { RateLimitStatusPanel } from "./RateLimitStatus";
import { useProviderSettingsForm } from "./use-provider-settings-form";
import { ProviderKindGrid } from "./ProviderKindGrid";
import { ProviderModelField } from "./ProviderModelField";

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
  const rateLimits = useRateLimitStatus();
  const form = useProviderSettingsForm(existing);
  const { kind, baseUrl, setBaseUrl, apiKey, setApiKey, model, setModel, models, fetching, needsBaseUrl } = form;

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

      <ProviderKindGrid kind={kind} onPick={form.pickKind} />

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
          <Label htmlFor="pv-key">API Key {existing.data?.hasKey ? "(tersimpan — isi ulang untuk mengganti)" : ""}</Label>
          <Input
            id="pv-key"
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={existing.data?.hasKey ? "•••••••• (tidak diubah)" : "tempel API key di sini"}
            autoComplete="off"
          />
          <p className="text-xs text-muted-foreground">Key dipakai untuk auto-fetch model dan request chat; disegel AES-256-GCM di server.</p>
        </div>

        <ProviderModelField
          model={model}
          onModelChange={setModel}
          models={models}
          fetching={fetching}
          onFetch={() => void form.handleFetchModels()}
        />

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
                    form.clearSecrets();
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
        Tanpa pengaturan tersimpan, chat memakai provider mock deterministik di server (untuk development). Saat pengaturan aktif, semua request chat
        memakai provider dan model pilihan Anda.
      </p>

      <div className="space-y-2">
        <h3 className="text-sm font-semibold">Status Rate Limit & Kuota</h3>
        <RateLimitStatusPanel data={rateLimits.data} loading={rateLimits.isLoading} />
      </div>
    </div>
  );
}
