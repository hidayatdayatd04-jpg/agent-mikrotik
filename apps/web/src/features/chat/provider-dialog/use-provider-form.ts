import { useState, useEffect } from "react";
import { toast } from "sonner";
import { PRESET_RECOMMENDATIONS, type DialogProviderConfig } from "./provider-presets";

export function useProviderForm(provider: DialogProviderConfig | null, open: boolean) {
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [activeModel, setActiveModel] = useState<string>("");
  const [newModelInput, setNewModelInput] = useState("");
  const [fetchingRemote, setFetchingRemote] = useState(false);
  const [remoteModels, setRemoteModels] = useState<{ id: string; label?: string }[] | null>(null);

  // Sync state when dialog opens or provider changes
  useEffect(() => {
    if (provider) {
      setName(provider.name || "");
      setBaseUrl(
        provider.baseUrl ||
          (provider.kind === "gemini"
            ? "https://generativelanguage.googleapis.com/v1beta/openai/v1"
            : provider.kind === "openrouter"
              ? "https://openrouter.ai/api/v1"
              : ""),
      );
      setApiKey("");
      setShowKey(false);
      const initialModels =
        provider.models && provider.models.length > 0 ? [...provider.models] : (PRESET_RECOMMENDATIONS[provider.kind]?.slice(0, 1) ?? []);
      setModels(initialModels);
      setActiveModel(provider.activeModel || initialModels[0] || "");
      setNewModelInput("");
      setRemoteModels(null);
    }
  }, [provider, open]);

  function handleAddModel(modelToAdd: string) {
    const trimmed = modelToAdd.trim();
    if (!trimmed) return;
    if (models.includes(trimmed)) {
      toast.info(`Model "${trimmed}" sudah ada di daftar.`);
      return;
    }
    const updated = [...models, trimmed];
    setModels(updated);
    if (!activeModel) {
      setActiveModel(trimmed);
    }
    setNewModelInput("");
  }

  function handleRemoveModel(modelToRemove: string) {
    const updated = models.filter((m) => m !== modelToRemove);
    setModels(updated);
    if (activeModel === modelToRemove) {
      setActiveModel(updated[0] || "");
    }
  }

  return {
    name,
    setName,
    baseUrl,
    setBaseUrl,
    apiKey,
    setApiKey,
    showKey,
    setShowKey,
    models,
    activeModel,
    setActiveModel,
    newModelInput,
    setNewModelInput,
    fetchingRemote,
    setFetchingRemote,
    remoteModels,
    setRemoteModels,
    kind: provider?.kind,
    hasSavedKey: provider?.hasKey,
    handleAddModel,
    handleRemoveModel,
  };
}

export type ProviderForm = ReturnType<typeof useProviderForm>;
