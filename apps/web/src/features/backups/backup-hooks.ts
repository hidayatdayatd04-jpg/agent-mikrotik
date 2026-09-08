import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import type { ConfigBackupDTO, DiffResult } from "@shared/index";

export function useBackups(connectionId?: string) {
  return useQuery({
    queryKey: ["backups", connectionId],
    queryFn: async () => {
      const q = connectionId ? `?connectionId=${encodeURIComponent(connectionId)}` : "";
      const res = await apiFetch<{ backups: ConfigBackupDTO[] }>(`/api/backups${q}`);
      return res.backups;
    },
  });
}

export function useBackup(id: string | null) {
  return useQuery({
    queryKey: ["backups", "detail", id],
    enabled: Boolean(id),
    queryFn: async () => {
      if (!id) throw new Error("ID backup diperlukan");
      const res = await apiFetch<{ backup: ConfigBackupDTO & { content: string | null } }>(`/api/backups/${id}`);
      return res.backup;
    },
  });
}

export function useCreateBackup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { connectionId: string; name?: string }) =>
      apiFetch<{ backup: ConfigBackupDTO }>(`/api/backups/${input.connectionId}`, {
        method: "POST",
        body: JSON.stringify({ name: input.name }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["backups"] });
    },
  });
}

export function useCompareBackups() {
  return useMutation({
    mutationFn: (input: { backupId1: string; backupId2: string }) =>
      apiFetch<{ diff: DiffResult }>("/api/backups/compare", {
        method: "POST",
        body: JSON.stringify(input),
      }),
  });
}

export function useCompareWithLive() {
  return useMutation({
    mutationFn: (input: { backupId: string; connectionId: string }) =>
      apiFetch<{ diff: DiffResult }>("/api/backups/compare-live", {
        method: "POST",
        body: JSON.stringify(input),
      }),
  });
}

export function useDeleteBackup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch<{ ok: boolean }>(`/api/backups/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["backups"] });
    },
  });
}
