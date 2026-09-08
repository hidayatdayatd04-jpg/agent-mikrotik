import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import {
  Key,
  ShieldCheck,
  Server,
  Info,
  ExternalLink,
  Cpu,
  Lock,
  Settings2,
  Plus,
} from "@/components/icons";
import {
  useAiProviders,
  useToggleAiProvider,
} from "./chat-hooks";
import { ProviderConfigDialog } from "./ProviderConfigDialog";
import { ModelLimitIndicator } from "./ModelLimitIndicator";
import { ProviderLogo, providerLogoId } from "./provider-logos";

type SettingsTab = "provider" | "safemode" | "about";

const DEFAULT_PROVIDER_TEMPLATES = [
  {
    id: "gemini",
    kind: "gemini" as const,
    name: "Google Gemini",
    desc: "Endpoint OpenAI-compatible resmi Google. Cepat & cerdas.",
    tag: "Rekomendasi",
    defaultUrl: "https://generativelanguage.googleapis.com/v1beta/openai/v1",
    models: ["gemini-2.0-flash", "gemini-1.5-flash", "gemini-1.5-pro"],
    activeModel: "gemini-2.0-flash",
  },
  {
    id: "openrouter",
    kind: "openrouter" as const,
    name: "OpenRouter",
    desc: "Akses ratusan model AI (Claude, GPT, Llama, DeepSeek) dalam satu API key.",
    tag: "Multi-Model",
    defaultUrl: "https://openrouter.ai/api/v1",
    models: ["anthropic/claude-3.5-sonnet", "deepseek/deepseek-chat", "meta-llama/llama-3.3-70b-instruct"],
    activeModel: "anthropic/claude-3.5-sonnet",
  },
];

export function SettingsPage(props: { initialTab?: SettingsTab; hideHeader?: boolean } = {}) {
  const [activeTab, setActiveTab] = useState<SettingsTab>(props.initialTab ?? "provider");
  const aiProviders = useAiProviders();
  const toggleProvider = useToggleAiProvider();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingProvider, setEditingProvider] = useState<{
    id?: string;
    kind: "gemini" | "openrouter" | "custom";
    name: string;
    baseUrl?: string;
    models?: string[];
    activeModel?: string;
    hasKey?: boolean;
    enabled?: boolean;
  } | null>(null);
  const [isNewCustom, setIsNewCustom] = useState(false);

  // Combine defaults with DB entries
  const standardProviders = DEFAULT_PROVIDER_TEMPLATES.map((tmpl) => {
    const saved = aiProviders.data?.find((p) => p.id === tmpl.id);
    if (saved) return saved;
    return {
      id: tmpl.id,
      kind: tmpl.kind,
      name: tmpl.name,
      baseUrl: tmpl.defaultUrl,
      models: tmpl.models,
      activeModel: tmpl.activeModel,
      enabled: false,
      hasKey: false,
    };
  });

  const customProviders =
    aiProviders.data?.filter(
      (p) => !DEFAULT_PROVIDER_TEMPLATES.some((tmpl) => tmpl.id === p.id)
    ) ?? [];

  const allDisplayProviders = [...standardProviders, ...customProviders];
  const anyHasKey = allDisplayProviders.some((p) => p.hasKey);

  function handleOpenEdit(provider: (typeof allDisplayProviders)[0], isNew = false) {
    setEditingProvider(provider);
    setIsNewCustom(isNew);
    setDialogOpen(true);
  }

  function handleToggle(p: (typeof allDisplayProviders)[0]) {
    if (!p.hasKey) {
      toast.info(`Isi API Key untuk ${p.name} terlebih dahulu melalui tombol Konfigurasi.`);
      handleOpenEdit(p, false);
      return;
    }
    toggleProvider.mutate(
      { id: p.id, enabled: !p.enabled },
      {
        onSuccess: (res) => {
          toast.success(
            `Provider ${p.name} berhasil ${res.provider.enabled ? "diaktifkan" : "dinonaktifkan"}.`
          );
        },
        onError: (err) => toast.error(err.message),
      }
    );
  }

  return (
    <div className={`${props.hideHeader ? "" : "mx-auto max-w-4xl space-y-6 p-4 sm:p-8 "}animate-in fade-in duration-300`}>
      {/* Header */}
      {!props.hideHeader && (
      <div className="border-b border-border/60 pb-5">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-indigo-500">
          <Cpu className="size-3.5" />
          Konfigurasi Sistem
        </div>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">Pengaturan</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Kelola provider kecerdasan buatan, preferensi RouterOS Safe Mode, dan diagnostik sistem.
        </p>

        {/* Tab Navigation */}
        <div className="mt-6 flex gap-2 border-b border-border/60">
          <button
            type="button"
            onClick={() => setActiveTab("provider")}
            className={`flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-all ${
              activeTab === "provider"
                ? "border-indigo-500 text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <Key className="size-4" />
            Provider AI
            {anyHasKey && (
              <span className="size-2 rounded-full bg-emerald-500 ring-2 ring-background" />
            )}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("safemode")}
            className={`flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-all ${
              activeTab === "safemode"
                ? "border-indigo-500 text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <ShieldCheck className="size-4" />
            Keamanan & Safe Mode
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("about")}
            className={`flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-all ${
              activeTab === "about"
                ? "border-indigo-500 text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <Info className="size-4" />
            Tentang Sistem
          </button>
        </div>
      </div>
      )}

      {/* Tab 1: Provider AI */}
      {activeTab === "provider" && (
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold">Daftar Provider Model AI</h2>
              <p className="text-xs text-muted-foreground">
                Setiap provider memiliki database dan API key terpisah (terisolasi). Aktifkan toggle
                untuk menyediakan model pada jendela chat.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                handleOpenEdit(
                  {
                    id: `custom-${Date.now()}`,
                    kind: "custom",
                    name: "Custom Provider",
                    baseUrl: "http://localhost:11434/v1",
                    models: ["llama3.2:latest"],
                    activeModel: "llama3.2:latest",
                    enabled: true,
                    hasKey: false,
                  },
                  true
                )
              }
              className="gap-1.5 text-xs self-start sm:self-auto"
            >
              <Plus className="size-3.5" />
              Tambah Provider Custom
            </Button>
          </div>

          {/* Provider Cards List */}
          <div className="grid gap-4 sm:grid-cols-2">
            {allDisplayProviders.map((p) => {
              const isEnabled = !!p.enabled;
              const hasModels = p.models && p.models.length > 0;
              const currentActive = p.activeModel || (hasModels ? p.models[0] : null);

              return (
                <div
                  key={p.id}
                  className={`group relative flex flex-col justify-between rounded-2xl border p-5 transition-all duration-200 ${
                    isEnabled
                      ? "border-indigo-500/50 bg-card shadow-sm ring-1 ring-indigo-500/20"
                      : "border-border/70 bg-card/60 hover:border-border hover:bg-card"
                  }`}
                >
                  <div className="space-y-3.5">
                    {/* Top Row: Provider Name, Tag, & Toggle */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2.5">
                        <div
                          className={`flex size-9 items-center justify-center rounded-xl ${
                            isEnabled
                              ? "bg-indigo-500/15 text-indigo-600 dark:text-indigo-400"
                              : "bg-muted text-muted-foreground"
                          }`}
                        >
                          <ProviderLogo logoId={providerLogoId(p)} alt={p.name} />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="text-sm font-semibold text-foreground">{p.name}</h3>
                            <span className="rounded-md bg-muted px-1.5 py-0.2 text-[10px] font-semibold text-muted-foreground">
                              {p.kind === "gemini"
                                ? "Google"
                                : p.kind === "openrouter"
                                ? "Multi-Model"
                                : "Custom"}
                            </span>
                          </div>
                          <span
                            className={`flex items-center gap-1 text-[11px] font-medium ${
                              p.hasKey
                                ? "text-emerald-600 dark:text-emerald-400"
                                : "text-amber-600 dark:text-amber-400"
                            }`}
                          >
                            <Lock className="size-2.5" />
                            {p.hasKey ? "Kunci Tersimpan (AES-256)" : "Belum ada API Key"}
                          </span>
                        </div>
                      </div>

                      {/* On/Off Switch Toggle */}
                      <div className="flex items-center gap-2 pt-0.5">
                        <span className="text-[11px] font-medium text-muted-foreground">
                          {isEnabled ? "Aktif" : "Nonaktif"}
                        </span>
                        <Switch
                          checked={isEnabled}
                          onCheckedChange={() => handleToggle(p)}
                          disabled={toggleProvider.isPending}
                          aria-label={`Aktifkan provider ${p.name}`}
                        />
                      </div>
                    </div>

                    {/* Middle Info: Active Model and Models count */}
                    <div className="rounded-xl border border-border/60 bg-muted/30 p-3 space-y-1.5">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">Model Aktif:</span>
                        {currentActive ? (
                          <span className="font-mono font-semibold text-indigo-600 dark:text-indigo-400 truncate max-w-[200px]">
                            {currentActive}
                          </span>
                        ) : (
                          <span className="text-muted-foreground italic">Belum ada model</span>
                        )}
                      </div>
                      {currentActive && <ModelLimitIndicator data={aiProviders.data?.find((provider) => provider.id === p.id)?.modelLimits?.[currentActive]} />}
                      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                        <span>Total model terdaftar:</span>
                        <span className="font-medium text-foreground">
                          {p.models?.length || 0} model
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Bottom Action: Konfigurasi Button */}
                  <div className="mt-4 flex items-center justify-between pt-3 border-t border-border/60">
                    <span className="text-[11px] text-muted-foreground truncate max-w-[160px] font-mono">
                      {p.baseUrl || "Default endpoint"}
                    </span>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => handleOpenEdit(p, false)}
                      className="h-8 gap-1.5 text-xs font-medium"
                    >
                      <Settings2 className="size-3.5" />
                      Konfigurasi
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Dialog Pop-up for Configuration */}
          <ProviderConfigDialog
            open={dialogOpen}
            onOpenChange={setDialogOpen}
            provider={editingProvider}
            isNew={isNewCustom}
          />
        </div>
      )}

      {/* Tab 2: Safe Mode */}
      {activeTab === "safemode" && (
        <div className="space-y-4 animate-in fade-in duration-200">
          <div className="rounded-2xl border border-border/70 bg-card/60 p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400">
                <ShieldCheck className="size-5" />
              </div>
              <div>
                <h2 className="text-base font-semibold">MikroTik Safe Mode & Write Mode Safeguard</h2>
                <p className="text-xs text-muted-foreground">
                  Mekanisme proteksi berlapis untuk mencegah kehilangan akses router akibat kesalahan konfigurasi.
                </p>
              </div>
            </div>

            <div className="grid gap-3 pt-2 sm:grid-cols-2">
              <div className="rounded-xl border border-border/70 bg-background/60 p-4">
                <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                  <span className="size-2 rounded-full bg-blue-500" />
                  Mode Default: Read-Only
                </h3>
                <p className="mt-1.5 text-xs text-muted-foreground leading-relaxed">
                  Semua koneksi router yang baru ditambahkan selalu berstatus <strong>Read-Only</strong>. Agen AI hanya
                  diperbolehkan membaca data (seperti status interface, tabel ARP, firewall rules, IP route, log) dan tidak dapat mengubah apa pun.
                </p>
              </div>

              <div className="rounded-xl border border-border/70 bg-background/60 p-4">
                <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                  <span className="size-2 rounded-full bg-amber-500" />
                  Safe Mode Otomatis
                </h3>
                <p className="mt-1.5 text-xs text-muted-foreground leading-relaxed">
                  Ketika <strong>Write Mode</strong> diaktifkan secara manual, setiap perubahan dieksekusi di dalam transaksi
                  RouterOS Safe Mode. Jika koneksi terputus atau terjadi kesalahan fatal, RouterOS akan secara otomatis membatalkan seluruh perubahan (rollback).
                </p>
              </div>
            </div>

            <div className="rounded-xl bg-muted/40 p-4 text-xs text-muted-foreground leading-relaxed space-y-2 border border-border/50">
              <p className="font-medium text-foreground">Kebijakan Keamanan Agen:</p>
              <ul className="list-disc pl-4 space-y-1">
                <li>Kredensial SSH router disimpan terenkripsi secara lokal (AES-256-GCM).</li>
                <li>Kata sandi router tidak pernah diteruskan ke model bahasa (LLM).</li>
                <li>Write Mode otomatis dicabut ketika sesi koneksi router ditutup atau diputus.</li>
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* Tab 3: About & System */}
      {activeTab === "about" && (
        <div className="space-y-4 animate-in fade-in duration-200">
          <div className="rounded-2xl border border-border/70 bg-card/60 p-6 space-y-5">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
                <Cpu className="size-5" />
              </div>
              <div>
                <h2 className="text-base font-semibold">MikroTik AI Agent</h2>
                <p className="text-xs text-muted-foreground">
                  Autonomous Network Operations Copilot untuk RouterOS v6 & v7.
                </p>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-border/70 bg-background/60 p-4">
                <span className="text-xs text-muted-foreground">Versi Aplikasi</span>
                <p className="mt-1 text-base font-bold font-mono">v0.1.0 (Dev)</p>
              </div>
              <div className="rounded-xl border border-border/70 bg-background/60 p-4">
                <span className="text-xs text-muted-foreground">Backend Runtime</span>
                <p className="mt-1 text-base font-bold font-mono">Bun + Hono + SQLite</p>
              </div>
              <div className="rounded-xl border border-border/70 bg-background/60 p-4">
                <span className="text-xs text-muted-foreground">Protokol Router</span>
                <p className="mt-1 text-base font-bold font-mono">SSH2 + Safe Mode</p>
              </div>
            </div>

            <div className="pt-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Dokumentasi & Referensi
              </h3>
              <div className="mt-3 flex flex-wrap gap-2">
                <a
                  href="https://help.mikrotik.com/docs/"
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1.5 rounded-lg border border-border/70 bg-background px-3 py-1.5 text-xs hover:border-indigo-500 hover:text-indigo-600 dark:hover:text-indigo-400"
                >
                  <Server className="size-3.5" />
                  MikroTik Help Docs
                  <ExternalLink className="size-3" />
                </a>
                <a
                  href="https://wiki.mikrotik.com/"
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1.5 rounded-lg border border-border/70 bg-background px-3 py-1.5 text-xs hover:border-indigo-500 hover:text-indigo-600 dark:hover:text-indigo-400"
                >
                  <Info className="size-3.5" />
                  MikroTik Wiki
                  <ExternalLink className="size-3" />
                </a>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
