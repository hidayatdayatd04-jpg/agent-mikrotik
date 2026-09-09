import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { PRESET_RECOMMENDATIONS, type DialogProviderConfig } from "./provider-dialog/provider-presets";
import { useProviderForm } from "./provider-dialog/use-provider-form";
import { useProviderActions } from "./provider-dialog/use-provider-actions";
import { ProviderCredentialFields } from "./provider-dialog/ProviderCredentialFields";
import { ProviderModelsSection } from "./provider-dialog/ProviderModelsSection";
import { ProviderDialogFooter } from "./provider-dialog/ProviderDialogFooter";
import { ProviderLogo, providerLogoId } from "./provider-logos";

export interface ProviderConfigDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  provider: DialogProviderConfig | null;
  isNew?: boolean;
}

export function ProviderConfigDialog({ open, onOpenChange, provider, isNew = false }: ProviderConfigDialogProps) {
  const form = useProviderForm(provider, open);
  const actions = useProviderActions(form, provider, onOpenChange);
  if (!provider) return null;

  const currentProvider = provider;
  const recommendations = PRESET_RECOMMENDATIONS[form.kind!] || [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto sm:p-6">
        <DialogHeader>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-indigo-500">
            <ProviderLogo
              logoId={providerLogoId({ kind: form.kind, id: currentProvider.id, name: form.name || currentProvider.name })}
              alt={form.name || currentProvider.name}
            />
            {isNew ? "Tambah Provider Baru" : "Pengaturan Provider AI"}
          </div>
          <DialogTitle className="text-xl font-bold tracking-tight">{form.name || currentProvider.name}</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Kelola endpoint URL, API Key, dan multi-model untuk provider ini. Data disimpan aman dalam database terpisah.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          <ProviderCredentialFields form={form} />

          {/* Multi-Model Management Section */}
          <ProviderModelsSection form={form} actions={actions} providerId={currentProvider.id} recommendations={recommendations} />
        </div>

        <DialogFooter className="flex items-center justify-between sm:justify-between pt-2 border-t border-border/60">
          <ProviderDialogFooter provider={currentProvider} isNew={isNew} actions={actions} onClose={() => onOpenChange(false)} />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
