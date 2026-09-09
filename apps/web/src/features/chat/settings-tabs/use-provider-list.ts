import { useState } from "react";
import { toast } from "sonner";
import { useAiProviders, useToggleAiProvider } from "../chat-hooks";
import { DEFAULT_PROVIDER_TEMPLATES } from "./provider-templates";

export interface EditingProvider {
  id?: string;
  kind: "gemini" | "openrouter" | "custom";
  name: string;
  baseUrl?: string;
  models?: string[];
  activeModel?: string;
  hasKey?: boolean;
  enabled?: boolean;
}

export function useProviderList() {
  const aiProviders = useAiProviders();
  const toggleProvider = useToggleAiProvider();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingProvider, setEditingProvider] = useState<EditingProvider | null>(null);
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

  const customProviders = aiProviders.data?.filter((p) => !DEFAULT_PROVIDER_TEMPLATES.some((tmpl) => tmpl.id === p.id)) ?? [];

  const allDisplayProviders = [...standardProviders, ...customProviders];
  const anyHasKey = allDisplayProviders.some((p) => p.hasKey);

  function handleOpenEdit(provider: EditingProvider, isNew = false) {
    setEditingProvider(provider);
    setIsNewCustom(isNew);
    setDialogOpen(true);
  }

  function handleToggle(p: (typeof allDisplayProviders)[number]) {
    if (!p.hasKey) {
      toast.info(`Isi API Key untuk ${p.name} terlebih dahulu melalui tombol Konfigurasi.`);
      handleOpenEdit(p as EditingProvider, false);
      return;
    }
    toggleProvider.mutate(
      { id: p.id, enabled: !p.enabled },
      {
        onSuccess: (res) => {
          toast.success(`Provider ${p.name} berhasil ${res.provider.enabled ? "diaktifkan" : "dinonaktifkan"}.`);
        },
        onError: (err) => toast.error(err.message),
      },
    );
  }

  return {
    aiProviders,
    togglePending: toggleProvider.isPending,
    dialogOpen,
    setDialogOpen,
    editingProvider,
    isNewCustom,
    allDisplayProviders,
    anyHasKey,
    handleOpenEdit,
    handleToggle,
  };
}

export type ProviderList = ReturnType<typeof useProviderList>;
export type DisplayProvider = ProviderList["allDisplayProviders"][number];
