import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch, ApiError } from "@/lib/api";

/** Types mirroring backend contracts (routes/chat.ts, routes/attachments.ts). */

export interface ConversationDTO {
  id: string;
  title: string;
  activeConnectionId: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface MessageDTO {
  id: string;
  role: "user" | "assistant";
  content: { text?: string; attachments?: { id: string; name: string; kind: string }[] };
  status: string;
  seq: number;
  createdAt: string;
}

export interface RunEventDTO {
  type:
    | "run.started"
    | "message.delta"
    | "tool.started"
    | "tool.completed"
    | "tool.failed"
    | "transaction.updated"
    | "run.completed"
    | "run.failed"
    | "run.cancelled";
  seq: number;
  runId: string;
  payload: Record<string, unknown>;
}

export interface AttachmentDTO {
  id: string;
  originalName: string;
  contentType: string;
  sizeBytes: number;
  status: string;
  contentKind?: string;
}

export function useConversations() {
  return useQuery({
    queryKey: ["conversations"],
    queryFn: async () => {
      const res = await apiFetch<{ conversations: ConversationDTO[] }>("/api/conversations");
      return res.conversations;
    },
  });
}

export function useConversation(id: string | null) {
  return useQuery({
    queryKey: ["conversation", id],
    enabled: !!id,
    queryFn: async () => {
      const res = await apiFetch<{ conversation: ConversationDTO }>(`/api/conversations/${id}`);
      return res.conversation;
    },
  });
}

export function useMessages(conversationId: string | null) {
  return useQuery({
    queryKey: ["messages", conversationId],
    enabled: !!conversationId,
    queryFn: async () => {
      const res = await apiFetch<{ messages: MessageDTO[] }>(`/api/conversations/${conversationId}/messages`);
      return res.messages;
    },
  });
}

export function useCreateConversation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { title?: string; connectionId?: string | null }) =>
      apiFetch<{ conversation: ConversationDTO }>("/api/conversations", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["conversations"] }),
  });
}

export function useUpdateConversation(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { title?: string; connectionId?: string | null }) =>
      apiFetch<{ conversation: ConversationDTO }>(`/api/conversations/${id}`, {
        method: "PATCH",
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["conversations"] });
      qc.invalidateQueries({ queryKey: ["conversation", id] });
    },
  });
}

export interface StartRunResult {
  runId: string;
  status: string;
  resumed?: boolean;
}

export function useStartRun(conversationId: string) {
  const qc = useQueryClient();
  return useMutation<StartRunResult, ApiError, { text: string; idempotencyKey: string; attachmentIds?: string[] }>({
    mutationFn: (input) =>
      apiFetch<StartRunResult>(`/api/conversations/${conversationId}/runs`, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["messages", conversationId] });
    },
  });
}

export function useCancelRun() {
  return useMutation({
    mutationFn: (runId: string) =>
      apiFetch<{ cancelled: boolean }>(`/api/runs/${runId}/cancel`, { method: "POST" }),
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

export interface ProviderSettingsDTO {
  kind: "gemini" | "openrouter" | "custom";
  baseUrl: string;
  model: string;
  hasKey?: boolean;
}

export function useProviderSettings() {
  return useQuery({
    queryKey: ["ai-provider"],
    queryFn: async () => {
      const res = await apiFetch<{ provider: ProviderSettingsDTO | null }>("/api/ai-provider");
      return res.provider;
    },
  });
}

export function useSaveProviderSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { kind: string; baseUrl?: string; model: string; apiKey?: string }) =>
      apiFetch<{ provider: ProviderSettingsDTO }>("/api/ai-provider", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ai-provider"] }),
  });
}

export function useDeleteProviderSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<{ deleted: boolean }>("/api/ai-provider", { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ai-provider"] }),
  });
}

/** Auto-fetch model list using a transient key — key is never stored by the backend. */
export async function fetchProviderModels(input: {
  kind: string;
  baseUrl?: string;
  apiKey: string;
}): Promise<{ models: { id: string; label?: string }[] }> {
  return apiFetch<{ models: { id: string; label?: string }[] }>("/api/ai-provider/models", {
    method: "POST",
    body: JSON.stringify(input),
  });
}
