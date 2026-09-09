import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import type { AiProviderDTO, ProviderSettingsDTO, RateLimitStatusDTO, PreferencesDTO } from "./types";

export { useAiProviders, useSaveAiProvider, useToggleAiProvider, useSetActiveModel, useDeleteAiProvider } from "./use-ai-providers";

export function useProviderSettings() {
  return useQuery({
    queryKey: ["ai-provider"],
    queryFn: async () => {
      const res = await apiFetch<{ providers: AiProviderDTO[]; activeProvider?: AiProviderDTO | null }>("/api/ai-provider");
      const active = res.activeProvider ?? res.providers?.find((p) => p.enabled) ?? res.providers?.[0];
      if (!active) return null;
      return {
        id: active.id,
        kind: active.kind,
        name: active.name,
        baseUrl: active.baseUrl,
        model: active.activeModel,
        hasKey: active.hasKey,
      } as ProviderSettingsDTO;
    },
  });
}

export function useSaveProviderSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id?: string; kind: string; baseUrl?: string; model: string; apiKey?: string; name?: string }) =>
      apiFetch<{ provider: AiProviderDTO }>("/api/ai-provider", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ai-providers"] });
      qc.invalidateQueries({ queryKey: ["ai-provider"] });
    },
  });
}

export function useDeleteProviderSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<{ deleted: boolean }>("/api/ai-provider", { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ai-providers"] });
      qc.invalidateQueries({ queryKey: ["ai-provider"] });
    },
  });
}

/** Auto-fetch model list using a transient key — key is never stored by the backend. */
export async function fetchProviderModels(input: {
  providerId?: string;
  kind: string;
  baseUrl?: string;
  apiKey?: string;
}): Promise<{ models: { id: string; label?: string }[] }> {
  return apiFetch<{ models: { id: string; label?: string }[] }>("/api/ai-provider/models", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/** Status rate limit terpusat untuk UI: model aktif, RPM/TPM, RPD, antrean, retry, fallback. */
export function useRateLimitStatus(refetchInterval = 10_000) {
  return useQuery({
    queryKey: ["ai-provider", "rate-limits"],
    refetchInterval,
    queryFn: async () => apiFetch<RateLimitStatusDTO>("/api/ai-provider/rate-limits"),
  });
}

export function usePreferences() {
  return useQuery({
    queryKey: ["preferences"],
    queryFn: async () => {
      const res = await apiFetch<{ preferences: PreferencesDTO }>("/api/preferences");
      return res.preferences;
    },
  });
}

export function useSavePreferences() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Partial<PreferencesDTO>) =>
      apiFetch<{ preferences: PreferencesDTO }>("/api/preferences", {
        method: "PATCH",
        body: JSON.stringify(input),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["preferences"] }),
  });
}
