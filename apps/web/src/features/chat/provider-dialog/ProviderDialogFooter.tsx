import { Button } from "@/components/ui/button";
import { Trash2, Loader2 } from "@/components/icons";
import type { DialogProviderConfig } from "./provider-presets";
import type { ProviderActions } from "./use-provider-actions";

export function ProviderDialogFooter(props: {
  provider: DialogProviderConfig;
  isNew: boolean;
  actions: ProviderActions;
  onClose: () => void;
}) {
  const { provider, isNew, actions, onClose } = props;
  const showDelete = !isNew && (provider.id === "custom" || provider.id?.startsWith("custom-"));
  return (
    <>
      <div>
        {showDelete && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={actions.handleDelete}
            className="text-xs text-destructive hover:bg-destructive/10"
          >
            <Trash2 className="size-3.5 mr-1" />
            Hapus Provider
          </Button>
        )}
      </div>
      <div className="flex items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onClose} className="text-xs">
          Batal
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={actions.handleSave}
          disabled={actions.savePending}
          className="text-xs bg-indigo-600 hover:bg-indigo-500 text-white gap-1.5"
        >
          {actions.savePending && <Loader2 className="size-3.5 animate-spin" />}
          Simpan Konfigurasi
        </Button>
      </div>
    </>
  );
}
