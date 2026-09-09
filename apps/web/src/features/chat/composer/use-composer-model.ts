import { useEffect, useState } from "react";
import { navigate } from "@/lib/router";
import { useAiProviders } from "../chat-hooks";
import { readProviderSelection, resolveProviderSelection, SELECTION_KEY } from "../provider-selection";

export function useComposerModel(text: string, draftKey?: string) {
  const aiProviders = useAiProviders();
  const enabledProviders = aiProviders.data?.filter((p) => p.enabled) ?? [];
  const availableModels: { model: string; providerId: string; providerName: string }[] = [];
  for (const p of enabledProviders) {
    for (const m of p.models || []) {
      availableModels.push({ model: m, providerId: p.id, providerName: p.name });
    }
  }

  const [selection, setSelection] = useState(readProviderSelection);
  const [modelQuery, setModelQuery] = useState("");
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const effectiveSelection = resolveProviderSelection(aiProviders.data ?? [], selection);
  const effectiveModel = effectiveSelection?.model ?? "";
  const effectiveProvider = enabledProviders.find((p) => p.id === effectiveSelection?.providerId);

  // Sembuhkan pilihan basi (provider dinonaktifkan / model dihapus) agar trigger,
  // context meter, dan run selalu memakai model yang sama.
  useEffect(() => {
    if (aiProviders.data === undefined || !effectiveSelection) return;
    if (selection?.providerId !== effectiveSelection.providerId || selection?.model !== effectiveSelection.model) {
      setSelection(effectiveSelection);
      try {
        localStorage.setItem(SELECTION_KEY, JSON.stringify(effectiveSelection));
      } catch {
        /* ignore */
      }
    }
  }, [aiProviders.data, effectiveSelection, selection]);

  function selectModel(providerId: string, model: string) {
    const next = { providerId, model };
    setSelection(next);
    try {
      localStorage.setItem(SELECTION_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }

  function goManageModels() {
    try {
      if (draftKey) localStorage.setItem(draftKey, text);
      sessionStorage.setItem("composer-draft", text);
    } catch {
      /* ignore */
    }
    navigate({ name: "settings", section: "providers" });
  }

  return {
    aiProviders,
    enabledProviders,
    availableModels,
    selection,
    modelQuery,
    setModelQuery,
    modelMenuOpen,
    setModelMenuOpen,
    effectiveSelection,
    effectiveModel,
    effectiveProvider,
    selectModel,
    goManageModels,
  };
}

export type ComposerModel = ReturnType<typeof useComposerModel>;
