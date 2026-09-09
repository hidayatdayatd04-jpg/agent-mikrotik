import { Button } from "@/components/ui/button";
import { Plus } from "@/components/icons";
import { ProviderConfigDialog } from "../ProviderConfigDialog";
import { ProviderCard } from "./ProviderCard";
import type { ProviderList } from "./use-provider-list";

export function ProviderTab(props: { page: ProviderList }) {
  const { page } = props;
  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Daftar Provider Model AI</h2>
          <p className="text-xs text-muted-foreground">
            Setiap provider memiliki database dan API key terpisah (terisolasi). Aktifkan toggle untuk menyediakan model pada jendela chat.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() =>
            page.handleOpenEdit(
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
              true,
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
        {page.allDisplayProviders.map((p) => {
          const hasModels = p.models && p.models.length > 0;
          const currentActive = p.activeModel || (hasModels ? p.models![0] : null);
          return (
            <ProviderCard
              key={p.id}
              p={p}
              togglePending={page.togglePending}
              modelLimit={
                currentActive
                  ? page.aiProviders.data?.find((provider) => provider.id === p.id)?.modelLimits?.[currentActive]
                  : undefined
              }
              onToggle={page.handleToggle}
              onEdit={(prov) => page.handleOpenEdit(prov, false)}
            />
          );
        })}
      </div>

      {/* Dialog Pop-up for Configuration */}
      <ProviderConfigDialog
        open={page.dialogOpen}
        onOpenChange={page.setDialogOpen}
        provider={page.editingProvider}
        isNew={page.isNewCustom}
      />
    </div>
  );
}
