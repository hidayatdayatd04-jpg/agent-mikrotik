import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import type { MonitoringLiveData } from "@shared/index";

export function useMonitoringLive(connectionId: string | undefined) {
  return useQuery({
    queryKey: ["monitoring", "live", connectionId],
    enabled: Boolean(connectionId),
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    queryFn: async () => {
      if (!connectionId) throw new Error("Connection ID diperlukan");
      return apiFetch<MonitoringLiveData>(`/api/monitoring/${connectionId}/live`);
    },
  });
}

export function useMonitoringHistory(
  connectionId: string | undefined,
  range: "1h" | "24h" | "7d" = "1h",
) {
  return useQuery({
    queryKey: ["monitoring", "history", connectionId, range],
    enabled: Boolean(connectionId),
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    queryFn: async () => {
      if (!connectionId) throw new Error("Connection ID diperlukan");
      const res = await apiFetch<{ history: { data: Record<string, unknown>; collectedAt: string }[] }>(
        `/api/monitoring/${connectionId}/history?range=${range}`,
      );
      return res.history;
    },
  });
}
