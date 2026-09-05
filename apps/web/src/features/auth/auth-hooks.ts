import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import type { SessionUser } from "@shared/index";

export interface MeResponse {
  user: SessionUser;
}

export function useMe() {
  return useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      try {
        return await apiFetch<MeResponse>("/api/auth/me");
      } catch (e: unknown) {
        if (e instanceof Error && "status" in e && (e as { status: number }).status === 401) {
          return null;
        }
        throw e;
      }
    },
    retry: false,
    staleTime: 60_000,
  });
}

export function useRequestOtp() {
  return useMutation({
    mutationFn: (email: string) =>
      apiFetch<{ sent: boolean; mockDelivery: boolean }>("/api/auth/otp/request", {
        method: "POST",
        body: JSON.stringify({ email }),
      }),
  });
}

export function useVerifyOtp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { email: string; code: string }) =>
      apiFetch<{ user: SessionUser }>("/api/auth/otp/verify", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["me"] }),
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<{ ok: boolean }>("/api/auth/logout", { method: "POST" }),
    onSuccess: () => {
      qc.setQueryData(["me"], null);
      qc.clear();
    },
  });
}
