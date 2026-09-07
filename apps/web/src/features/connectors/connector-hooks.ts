import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import type { ConnectorDTO, RouterMode } from "@shared/index";

export interface DiscoveredRouterDTO {
  ip: string;
  mac: string;
  identity: string;
  version: string;
  platform: string;
  board: string;
  interface: string;
  ipv4: string;
  uptimeSeconds?: number;
  sshAvailable: boolean;
  alreadyAdded: boolean;
  connectorId?: string | null;
  connectorStatus?: string | null;
}

export function useConnectors() {
  return useQuery({
    queryKey: ["connectors"],
    // Re-poll: a backend restart revokes write + disconnects (by design), and
    // a cached "Write aktif" badge would otherwise lie to the user.
    refetchInterval: 15_000,
    queryFn: async () => {
      const res = await apiFetch<{ connectors: ConnectorDTO[] }>("/api/connectors");
      return res.connectors;
    },
  });
}

export function useDiscoverConnectors() {
  return useQuery({
    queryKey: ["connectors", "discover"],
    queryFn: async () => {
      const res = await apiFetch<{ discovered: DiscoveredRouterDTO[] }>("/api/connectors/discover");
      return res.discovered;
    },
    staleTime: 10_000,
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

export interface WriteReadinessDTO {
  connectorId: string;
  status: string;
  mode: RouterMode;
  modeVersion: number;
  /** true = stored secret empty (write cannot work); null = unreadable */
  credentialEmpty: boolean | null;
  blocked: "read-only" | "disconnected" | "empty-credential" | "credential-unreadable" | null;
}

/** User-facing write-block reason. Only booleans cross the wire — never secrets. */
export function useWriteReadiness(id: string | null | undefined) {
  return useQuery({
    queryKey: ["write-readiness", id],
    enabled: !!id,
    refetchInterval: 15_000,
    queryFn: async () => {
      const res = await apiFetch<WriteReadinessDTO>(`/api/connectors/${id}/write-readiness`);
      return res;
    },
  });
}

export function useDeleteConnector(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<{ ok: boolean }>(`/api/connectors/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["connectors"] }),
  });
}
