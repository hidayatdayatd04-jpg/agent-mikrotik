import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import type { ConnectorDTO, RouterMode } from "@shared/index";

export function useConnectors() {
  return useQuery({
    queryKey: ["connectors"],
    queryFn: async () => {
      const res = await apiFetch<{ connectors: ConnectorDTO[] }>("/api/connectors");
      return res.connectors;
    },
  });
}

export function useCreateConnector() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { label: string; host: string; port: number; username: string; password: string }) =>
      apiFetch<{ connector: ConnectorDTO; probe: { ok: boolean; routerIdentity: string | null } }>("/api/connectors", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["connectors"] }),
  });
}

export function useUpdateConnector(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { label?: string; host?: string; port?: number; username?: string; password?: string }) =>
      apiFetch<{ connector: ConnectorDTO }>(`/api/connectors/${id}`, {
        method: "PATCH",
        body: JSON.stringify(input),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["connectors"] }),
  });
}

export function useConnectConnector(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch<{ connector: ConnectorDTO }>(`/api/connectors/${id}/connect`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["connectors"] }),
  });
}

export function useDisconnectConnector(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch<{ connector: ConnectorDTO }>(`/api/connectors/${id}/disconnect`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["connectors"] }),
  });
}

export function useSetConnectorMode(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { mode: RouterMode; expectedVersion: number }) =>
      apiFetch<{ connector: ConnectorDTO; version: number }>(`/api/connectors/${id}/mode`, {
        method: "PATCH",
        body: JSON.stringify(input),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["connectors"] }),
  });
}

export function useDeleteConnector(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<{ ok: boolean }>(`/api/connectors/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["connectors"] }),
  });
}
