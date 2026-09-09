import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import type { AiProviderDTO } from "./types";

export function useAiProviders() {
  return useQuery({
    queryKey: ["ai-providers"],
    refetchInterval: 15_000,
    queryFn: async () => {
      const res = await apiFetch<{ providers: AiProviderDTO[] }>("/api/ai-provider");
      return res.providers ?? [];
    },
  });
}

export function useSaveAiProvider() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      id?: string;
      kind: "gemini" | "openrouter" | "custom";
      name?: string;
      baseUrl?: string;
      apiKey?: string;
      models?: string[];
      activeModel?: string;
      enabled?: boolean;
    }) =>
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

export function useToggleAiProvider() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      apiFetch<{ provider: AiProviderDTO }>(`/api/ai-provider/${id}/toggle`, {
        method: "PATCH",
        body: JSON.stringify({ enabled }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ai-providers"] });
      qc.invalidateQueries({ queryKey: ["ai-provider"] });
    },
  });
}

export function useSetActiveModel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, model }: { id: string; model: string }) =>
      apiFetch<{ provider: AiProviderDTO }>(`/api/ai-provider/${id}/active-model`, {
        method: "PATCH",
        body: JSON.stringify({ model }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ai-providers"] });
      qc.invalidateQueries({ queryKey: ["ai-provider"] });
    },
  });
}

export function useDeleteAiProvider() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch<{ deleted: boolean }>(`/api/ai-provider/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ai-providers"] });
      qc.invalidateQueries({ queryKey: ["ai-provider"] });
    },
  });
}
