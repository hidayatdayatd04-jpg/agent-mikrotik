import { useEffect, useState } from "react";
import { toast } from "sonner";
import { fetchProviderModels } from "./chat-hooks";

export const PROVIDER_KINDS = [
  { id: "gemini", label: "Google Gemini", hint: "Endpoint OpenAI-compatible resmi Google" },
  { id: "openrouter", label: "OpenRouter", hint: "Banyak model dalam satu API" },
  { id: "custom", label: "Custom", hint: "ApiKey + BaseURL + model manual (OpenAI-compatible)" },
] as const;

export function useProviderSettingsForm(existing: { data?: { kind: string; baseUrl?: string | null; model?: string | null; hasKey?: boolean } | null }) {
  const [kind, setKind] = useState<string>("gemini");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [models, setModels] = useState<{ id: string; label?: string }[] | null>(null);
  const [fetching, setFetching] = useState(false);

  // prefill from the saved settings (never the key itself)
  useEffect(() => {
    if (existing.data) {
      setKind(existing.data.kind);
      setBaseUrl(existing.data.baseUrl ?? "");
      setModel(existing.data.model ?? "");
      setApiKey("");
      setModels(null);
    }
  }, [existing.data]);

  const needsBaseUrl = kind === "custom";

  async function handleFetchModels() {
    if (!apiKey || apiKey.length < 8) {
      toast.error("Isi API key dulu untuk mengambil daftar model (minimal 8 karakter).");
      return;
    }
    if (needsBaseUrl && !baseUrl) {
      toast.error("Provider Custom wajib mengisi Base URL.");
      return;
    }
    setFetching(true);
    setModels(null);
    try {
      const res = await fetchProviderModels({ kind, baseUrl: needsBaseUrl ? baseUrl : undefined, apiKey });
      setModels(res.models);
      if (res.models.length === 0) toast.info("Provider tidak mengembalikan model apa pun.");
      else toast.success(`${res.models.length} model ditemukan — pilih satu atau tulis manual.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal mengambil daftar model.");
    } finally {
      setFetching(false);
    }
  }

  function pickKind(id: string) {
    setKind(id);
    setModels(null);
    if (id === "custom") setBaseUrl("");
    else setBaseUrl(id === "gemini" ? "https://generativelanguage.googleapis.com/v1beta/openai/v1" : "https://openrouter.ai/api/v1");
  }

  function clearSecrets() {
    setApiKey("");
    setModel("");
    setModels(null);
  }

  return {
    kind,
    baseUrl,
    setBaseUrl,
    apiKey,
    setApiKey,
    model,
    setModel,
    models,
    fetching,
    needsBaseUrl,
    handleFetchModels,
    pickKind,
    clearSecrets,
  };
}
