import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch, ApiError } from "@/lib/api";
import type { ModelLimitStatus } from "@shared/index";

/** Types mirroring backend contracts (routes/chat.ts, routes/attachments.ts). */

export interface ConversationDTO {
  id: string;
  title: string;
  activeConnectionId: string | null;
  createdAt: string;
  updatedAt: string;
  pinnedAt: string | null;
  archivedAt: string | null;
  revision?: number;
}

export interface MessageDTO {
  id: string;
  role: "user" | "assistant";
  content: { text?: string; runId?: string; timeline?: RunEventDTO[]; attachments?: { id: string; name: string; kind: string }[]; outcome?: { status: string; code?: string; reason?: string; toolSucceeded?: number; toolFailed?: number; succeededTools?: string[] } };
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
    | "provider.waiting"
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

export function useConversations(opts: { archived?: boolean | "all"; search?: string } = {}) {
  const archived = opts.archived === true ? "true" : opts.archived === "all" ? "all" : "false";
  return useQuery({
    queryKey: ["conversations", archived, opts.search ?? ""],
    queryFn: async () => {
      const params = new URLSearchParams({ archived, limit: "100" });
      if (opts.search) params.set("search", opts.search);
      const res = await apiFetch<{ conversations: ConversationDTO[]; nextCursor: string | null }>(
        `/api/conversations?${params.toString()}`,
      );
      return res.conversations;
    },
  });
}

export function useArchivedConversations() {
  return useConversations({ archived: true });
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
    mutationFn: (input: { title?: string; connectionId?: string | null; pinned?: boolean; archived?: boolean; expectedRevision?: number }) =>
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

export function useConversationActions(id: string) {
  const update = useUpdateConversation(id);
  return {
    rename: (title: string) => update.mutateAsync({ title }),
    setPinned: (pinned: boolean) => update.mutateAsync({ pinned }),
    setArchived: (archived: boolean) => update.mutateAsync({ archived }),
    update,
    exportMd: async () => {
      const res = await fetch(`/api/conversations/${id}/export?format=md`, { credentials: "same-origin" });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error((body as { error?: { message?: string } })?.error?.message ?? "Export gagal.");
      }
      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") ?? "";
      const match = disposition.match(/filename="([^"]+)"/);
      const filename = match?.[1] ?? `chat-${id}.md`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    },
  };
}

export function useDeleteConversation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ ok: boolean }>(`/api/conversations/${id}`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["conversations"] });
    },
  });
}

export interface StartRunResult {
  runId: string;
  status: string;
  resumed?: boolean;
}

export interface StartRunInput {
  text: string;
  idempotencyKey: string;
  attachmentIds?: string[];
  model?: string;
  providerId?: string;
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
    mutationFn: (runId: string) =>
      apiFetch<{ ok: boolean }>(`/api/runs/${runId}/cancel`, { method: "POST" }),
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

export interface AiProviderDTO {
  id: string;
  kind: "gemini" | "openrouter" | "custom";
  name: string;
  baseUrl: string;
  models: string[];
  activeModel: string;
  enabled: boolean;
  hasKey: boolean;
  updatedAt?: string;
  modelLimits?: Record<string, ModelLimitStatus>;
}

export interface ProviderSettingsDTO {
  id?: string;
  kind: "gemini" | "openrouter" | "custom";
  name?: string;
  baseUrl: string;
  model: string;
  hasKey?: boolean;
}

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
    mutationFn: (id: string) =>
      apiFetch<{ deleted: boolean }>(`/api/ai-provider/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ai-providers"] });
      qc.invalidateQueries({ queryKey: ["ai-provider"] });
    },
  });
}

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

export interface RateLimitStatusDTO {
  defaults: { rpm: number; tpm: number };
  activeModel: string | null;
  activeProviderId: string | null;
  globalQueue: number;
  models: {
    modelKey: string;
    providerKind: string;
    rpmUsed: number;
    rpmLimit: number;
    tpmUsed: number;
    tpmLimit: number;
    rpdStatus: { limit: number | null; remaining: number | null; resetAt: string | null } | null;
    queueLength: number;
    nextRetryAt: string | null;
    blockedReason: string | null;
    fallbackReason: string | null;
    isDailyQuotaExhausted: boolean;
  }[];
  checkpoints: { id: string; primaryModelKey: string | null; reason: string; nextRetryAt: string | null; createdAt: string }[];
  note: string;
}

/** Status rate limit terpusat untuk UI: model aktif, RPM/TPM, RPD, antrean, retry, fallback. */
export function useRateLimitStatus(refetchInterval = 10_000) {
  return useQuery({
    queryKey: ["ai-provider", "rate-limits"],
    refetchInterval,
    queryFn: async () => apiFetch<RateLimitStatusDTO>("/api/ai-provider/rate-limits"),
  });
}

export interface ActivityEventDTO {
  id: string;
  conversationId: string;
  runId: string | null;
  activityId: string;
  parentId: string | null;
  seq: number;
  type: string;
  actor: "user" | "ai" | "system";
  payload: Record<string, unknown>;
  createdAt: string;
}

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

export interface TerminalCommandDTO {
  id: string;
  command: string;
  status: string;
  exitCode: number | null;
  outputPreview: string;
  truncated: boolean;
  errorCode: string | null;
  transactionId: string | null;
  durationMs: number | null;
  createdAt: string;
  endedAt?: string | null;
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

export interface PreferencesDTO {
  theme: "light" | "dark" | "system";
  sidebarCollapsed: boolean;
  autoCompact: boolean;
  compactThreshold: number;
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

export function groupConversations(items: ConversationDTO[]): { label: string; items: ConversationDTO[] }[] {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfYesterday = startOfToday - 24 * 60 * 60 * 1000;
  const weekAgo = startOfToday - 7 * 24 * 60 * 60 * 1000;
  const pinned = items.filter((c) => c.pinnedAt).sort((a, b) => (b.pinnedAt ?? "").localeCompare(a.pinnedAt ?? ""));
  const rest = items.filter((c) => !c.pinnedAt);
  const buckets: Record<string, ConversationDTO[]> = {
    "Hari ini": [],
    Kemarin: [],
    "7 hari terakhir": [],
    "Lebih lama": [],
  };
  for (const c of rest) {
    const t = new Date(c.updatedAt).getTime();
    if (t >= startOfToday) buckets["Hari ini"]!.push(c);
    else if (t >= startOfYesterday) buckets.Kemarin!.push(c);
    else if (t >= weekAgo) buckets["7 hari terakhir"]!.push(c);
    else buckets["Lebih lama"]!.push(c);
  }
  const out: { label: string; items: ConversationDTO[] }[] = [];
  if (pinned.length > 0) out.push({ label: "Disematkan", items: pinned });
  for (const label of ["Hari ini", "Kemarin", "7 hari terakhir", "Lebih lama"]) {
    if (buckets[label]!.length > 0) out.push({ label, items: buckets[label]! });
  }
  return out;
}
