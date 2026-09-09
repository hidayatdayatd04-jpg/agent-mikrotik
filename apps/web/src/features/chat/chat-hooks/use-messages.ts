import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch, ApiError } from "@/lib/api";
import type { MessageDTO, RunEventDTO, AttachmentDTO, StartRunResult, StartRunInput } from "./types";

export function useMessages(conversationId: string | null, pollInterval?: number | false) {
  return useQuery({
    queryKey: ["messages", conversationId],
    enabled: !!conversationId,
    refetchInterval: pollInterval ?? false,
    queryFn: async () => {
      const res = await apiFetch<{ messages: MessageDTO[] }>(`/api/conversations/${conversationId}/messages`);
      return res.messages;
    },
  });
}

export function useStartRun(conversationId: string) {
  const qc = useQueryClient();
  return useMutation<StartRunResult, ApiError, StartRunInput>({
    mutationFn: (input) =>
      apiFetch<StartRunResult>(`/api/conversations/${conversationId}/runs`, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["messages", conversationId] });
      qc.invalidateQueries({ queryKey: ["conversations"] });
    },
  });
}

export function useCancelRun() {
  return useMutation({
    mutationFn: (runId: string) => apiFetch<{ ok: boolean }>(`/api/runs/${runId}/cancel`, { method: "POST" }),
  });
}

export function useRunSnapshot(runId: string | null) {
  return useQuery({
    queryKey: ["run", runId],
    enabled: !!runId,
    queryFn: async () => {
      const res = await apiFetch<{ run: { id: string; status: string; usage: unknown }; events: RunEventDTO[] }>(`/api/runs/${runId}`);
      return res;
    },
  });
}

/** Upload an attachment file into a conversation (multipart via apiForm). */
export function useUploadAttachment(conversationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (file: File) => {
      const { apiForm } = await import("@/lib/api");
      const form = new FormData();
      form.append("file", file);
      return apiForm<{ attachment: AttachmentDTO }>(`/api/attachments/${conversationId}/files`, form);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["attachments", conversationId] }),
  });
}

export function useDeleteAttachment(conversationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (attachmentId: string) =>
      apiFetch<{ deleted: boolean }>(`/api/attachments/files/${attachmentId}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["attachments", conversationId] }),
  });
}
