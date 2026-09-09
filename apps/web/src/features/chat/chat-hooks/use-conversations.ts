import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import type { ConversationDTO } from "./types";

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
