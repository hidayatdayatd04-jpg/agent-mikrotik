import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Lock, Settings2 } from "@/components/icons";
import type { ModelLimitStatus } from "@shared/index";
import { ModelLimitIndicator } from "../ModelLimitIndicator";
import { ProviderLogo, providerLogoId } from "../provider-logos";
import type { DisplayProvider } from "./use-provider-list";

export function ProviderCard(props: {
  p: DisplayProvider;
  togglePending: boolean;
  modelLimit: ModelLimitStatus | undefined;
  onToggle: (p: DisplayProvider) => void;
  onEdit: (p: DisplayProvider) => void;
}) {
  const { p } = props;
  const isEnabled = !!p.enabled;
  const hasModels = p.models && p.models.length > 0;
  const currentActive = p.activeModel || (hasModels ? p.models![0] : null);

  return (
    <div
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
                isEnabled ? "bg-indigo-500/15 text-indigo-600 dark:text-indigo-400" : "bg-muted text-muted-foreground"
              }`}
            >
              <ProviderLogo logoId={providerLogoId(p)} alt={p.name} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-foreground">{p.name}</h3>
                <span className="rounded-md bg-muted px-1.5 py-0.2 text-[10px] font-semibold text-muted-foreground">
                  {p.kind === "gemini" ? "Google" : p.kind === "openrouter" ? "Multi-Model" : "Custom"}
                </span>
              </div>
              <span
                className={`flex items-center gap-1 text-[11px] font-medium ${
                  p.hasKey ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"
                }`}
              >
                <Lock className="size-2.5" />
                {p.hasKey ? "Kunci Tersimpan (AES-256)" : "Belum ada API Key"}
              </span>
            </div>
          </div>

          {/* On/Off Switch Toggle */}
          <div className="flex items-center gap-2 pt-0.5">
            <span className="text-[11px] font-medium text-muted-foreground">{isEnabled ? "Aktif" : "Nonaktif"}</span>
            <Switch
              checked={isEnabled}
              onCheckedChange={() => props.onToggle(p)}
              disabled={props.togglePending}
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
          {currentActive && <ModelLimitIndicator data={props.modelLimit} />}
          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span>Total model terdaftar:</span>
            <span className="font-medium text-foreground">{p.models?.length || 0} model</span>
          </div>
        </div>
      </div>

      {/* Bottom Action: Konfigurasi Button */}
      <div className="mt-4 flex items-center justify-between pt-3 border-t border-border/60">
        <span className="text-[11px] text-muted-foreground truncate max-w-[160px] font-mono">{p.baseUrl || "Default endpoint"}</span>
        <Button type="button" variant="secondary" size="sm" onClick={() => props.onEdit(p)} className="h-8 gap-1.5 text-xs font-medium">
          <Settings2 className="size-3.5" />
          Konfigurasi
        </Button>
      </div>
    </div>
  );
}
