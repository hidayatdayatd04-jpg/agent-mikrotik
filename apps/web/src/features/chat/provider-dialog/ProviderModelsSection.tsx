import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, Trash2, RefreshCw, Loader2 } from "@/components/icons";
import { ModelLimitIndicator } from "../ModelLimitIndicator";
import { useAiProviders } from "../chat-hooks";
import type { ProviderForm } from "./use-provider-form";
import type { ProviderActions } from "./use-provider-actions";
import { ProviderRecommendationChips } from "./ProviderRecommendationChips";
import { ProviderRemoteModels } from "./ProviderRemoteModels";

export function ProviderModelsSection(props: {
  form: ProviderForm;
  actions: ProviderActions;
  providerId: string | undefined;
  recommendations: string[];
}) {
  const { form, actions, providerId, recommendations } = props;
  const liveProviders = useAiProviders();
  return (
    <div className="rounded-xl border border-border/70 bg-muted/20 p-4 space-y-3.5">
      <div className="flex items-center justify-between">
        <div>
          <Label className="text-xs font-semibold flex items-center gap-1.5">Kelola Daftar Model ({form.models.length})</Label>
          <p className="text-[11px] text-muted-foreground">Tambahkan lebih dari satu model. Model ini akan muncul di pilihan chat.</p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void actions.handleFetchRemoteModels()}
          disabled={form.fetchingRemote || (!form.apiKey && !form.hasSavedKey)}
          className="h-8 gap-1.5 text-xs"
        >
          {form.fetchingRemote ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
          Tarik Model
        </Button>
      </div>

      {/* Recommendations Quick Chips */}
      <ProviderRecommendationChips recommendations={recommendations} models={form.models} onAdd={form.handleAddModel} />

      {/* Remote Models Picker if fetched */}
      <ProviderRemoteModels remoteModels={form.remoteModels} models={form.models} onAdd={form.handleAddModel} />

      {/* Configured Models List */}
      <div className="space-y-2">
        <span className="text-xs font-semibold">Model Terdaftar:</span>
        {form.models.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border/80 p-3 text-center text-xs text-muted-foreground">
            Belum ada model yang ditambahkan. Gunakan rekomendasi di atas atau masukkan manual.
          </p>
        ) : (
          <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
            {form.models.map((m) => {
              const isActive = form.activeModel === m;
              return (
                <div
                  key={m}
                  className={`flex items-center justify-between rounded-lg border px-3 py-2 text-xs transition-colors ${
                    isActive ? "border-indigo-500/60 bg-indigo-500/[0.08]" : "border-border/70 bg-card hover:border-border"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => form.setActiveModel(m)}
                    className="flex items-center gap-2 text-left flex-1 min-w-0"
                    title="Klik untuk jadikan model aktif default"
                  >
                    <div
                      className={`size-3.5 rounded-full border flex items-center justify-center shrink-0 ${
                        isActive ? "border-indigo-500 bg-indigo-500" : "border-muted-foreground/50"
                      }`}
                    >
                      {isActive && <div className="size-1.5 rounded-full bg-white" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <span className="font-mono font-medium break-all">{m}</span>
                      <ModelLimitIndicator data={liveProviders.data?.find((p) => p.id === providerId)?.modelLimits?.[m]} />
                    </div>
                    {isActive && (
                      <span className="rounded bg-indigo-500/20 px-1.5 py-0.2 text-[10px] font-semibold text-indigo-600 dark:text-indigo-400">
                        Model Aktif
                      </span>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => form.handleRemoveModel(m)}
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
          value={form.newModelInput}
          onChange={(e) => form.setNewModelInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              form.handleAddModel(form.newModelInput);
            }
          }}
          placeholder="Tambah model manual (misal: gpt-4o, claude-3-haiku)..."
          className="h-8 text-xs font-mono"
        />
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => form.handleAddModel(form.newModelInput)}
          disabled={!form.newModelInput.trim()}
          className="h-8 shrink-0 text-xs gap-1"
        >
          <Plus className="size-3.5" />
          Tambah
        </Button>
      </div>
    </div>
  );
}
