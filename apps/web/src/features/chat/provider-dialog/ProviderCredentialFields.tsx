import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Eye, EyeOff, Lock } from "@/components/icons";
import type { ProviderForm } from "./use-provider-form";

export function ProviderCredentialFields(props: { form: ProviderForm }) {
  const { form } = props;
  const kind = form.kind;
  const hasSavedKey = form.hasSavedKey;
  return (
    <>
      {/* Provider Name */}
      <div className="space-y-1.5">
        <Label htmlFor="provider-name" className="text-xs font-semibold">
          Nama Provider
        </Label>
        <Input
          id="provider-name"
          value={form.name}
          onChange={(e) => form.setName(e.target.value)}
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
          {kind === "gemini" && <span className="text-[11px] text-muted-foreground">Endpoint resmi Gemini v1beta</span>}
          {kind === "openrouter" && <span className="text-[11px] text-muted-foreground">openrouter.ai/api/v1</span>}
        </div>
        <Input
          id="provider-base-url"
          value={form.baseUrl}
          onChange={(e) => form.setBaseUrl(e.target.value)}
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
            type={form.showKey ? "text" : "password"}
            value={form.apiKey}
            onChange={(e) => form.setApiKey(e.target.value)}
            placeholder={hasSavedKey ? "•••••••••••••••• (Kosongkan jika tidak ingin mengubah)" : "Masukkan API key..."}
            className="h-9 pr-10 font-mono text-xs"
          />
          <button
            type="button"
            onClick={() => form.setShowKey(!form.showKey)}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
            aria-label={form.showKey ? "Sembunyikan API key" : "Tampilkan API key"}
          >
            {form.showKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </div>
        <p className="text-[11px] text-muted-foreground">Disimpan terenkripsi dengan AES-256-GCM. Tidak pernah diekspos ke browser setelah disimpan.</p>
      </div>
    </>
  );
}
