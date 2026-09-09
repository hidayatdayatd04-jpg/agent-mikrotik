import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import type { ActivityEventDTO, TerminalCommandDTO } from "./types";

export function useConversationActivities(conversationId: string | null) {
  return useQuery({
    queryKey: ["activities", conversationId],
    enabled: !!conversationId,
    queryFn: async () => {
      const res = await apiFetch<{ events: ActivityEventDTO[]; nextCursor: number | null }>(
        `/api/conversations/${conversationId}/activities?limit=200`,
      );
      return res.events;
    },
  });
}

export function useCompactionStatus(conversationId: string | null) {
  return useQuery({
    queryKey: ["compaction", conversationId],
    enabled: !!conversationId,
    refetchInterval: 4000,
    queryFn: async () => {
      const res = await apiFetch<{
        summary: { version: number; throughSeq: number; model: string | null } | null;
        jobs: { id: string; status: string; reason: string; error: string | null }[];
      }>(`/api/conversations/${conversationId}/compaction`);
      return res;
    },
  });
}

export function useStartCompaction(conversationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch<{ jobId: string; status: string }>(`/api/conversations/${conversationId}/compact`, {
        method: "POST",
        body: JSON.stringify({ reason: "manual" }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["compaction", conversationId] }),
  });
}

export function useTerminalSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { connectionId: string; conversationId?: string | null }) =>
      apiFetch<{ session: { id: string; status: string } }>("/api/terminal/sessions", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["terminal"] }),
  });
}

export function useTerminalCommands(sessionId: string | null) {
  return useQuery({
    queryKey: ["terminal", sessionId],
    enabled: !!sessionId,
    refetchInterval: 2000,
    queryFn: async () => {
      const res = await apiFetch<{ commands: TerminalCommandDTO[] }>(`/api/terminal/sessions/${sessionId}/commands`);
      return res.commands;
    },
  });
}

export function useSendTerminalCommand(sessionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { command: string; conversationId?: string | null }) =>
      apiFetch<{ commandId: string }>(`/api/terminal/sessions/${sessionId}/commands`, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["terminal", sessionId] }),
  });
}
