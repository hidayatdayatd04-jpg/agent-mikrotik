import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import type { ApprovalDTO, OperationLogDTO } from "@shared/index";

export function useApprovals(opts: { connectionId?: string; conversationId?: string; status?: string } = {}) {
  const query = new URLSearchParams();
  if (opts.connectionId) query.set("connectionId", opts.connectionId);
  if (opts.conversationId) query.set("conversationId", opts.conversationId);
  if (opts.status) query.set("status", opts.status);

  return useQuery({
    queryKey: ["approvals", opts],
    queryFn: async () => {
      const q = query.toString();
      const res = await apiFetch<{ approvals: ApprovalDTO[] }>(`/api/approvals${q ? `?${q}` : ""}`);
      return res.approvals;
    },
    refetchInterval: 10_000,
  });
}

export function useApproval(id: string | null) {
  return useQuery({
    queryKey: ["approvals", "detail", id],
    enabled: Boolean(id),
    queryFn: async () => {
      if (!id) throw new Error("ID approval diperlukan");
      const res = await apiFetch<{ approval: ApprovalDTO }>(`/api/approvals/${id}`);
      return res.approval;
    },
  });
}

export function useCreateApproval() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      connectionId: string;
      summary: string;
      operations: Array<{ command: string; description: string; risk?: "read" | "write" | "destructive" }>;
      riskLevel?: "low" | "medium" | "high" | "critical";
      impactDescription?: string;
      affectedObjects?: string[];
      conversationId?: string;
    }) =>
      apiFetch<{ approval: ApprovalDTO }>("/api/approvals", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["approvals"] });
    },
  });
}

export function useApproveRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ approval: ApprovalDTO }>(`/api/approvals/${id}/approve`, { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["approvals"] });
    },
  });
}

export function useRejectRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; reason?: string }) =>
      apiFetch<{ approval: ApprovalDTO }>(`/api/approvals/${input.id}/reject`, {
        method: "POST",
        body: JSON.stringify({ reason: input.reason }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["approvals"] });
    },
  });
}

export function useExecuteApproval() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ approval: ApprovalDTO }>(`/api/approvals/${id}/execute`, { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["approvals"] });
    },
  });
}

export function useApprovalLog(id: string | null) {
  return useQuery({
    queryKey: ["approvals", "log", id],
    enabled: Boolean(id),
    queryFn: async () => {
      if (!id) throw new Error("ID approval diperlukan");
      const res = await apiFetch<{ log: OperationLogDTO[] }>(`/api/approvals/${id}/log`);
      return res.log;
    },
  });
}
