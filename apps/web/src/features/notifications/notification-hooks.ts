import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import type { NotificationDTO, NotificationSettingsDTO } from "@shared/index";

export function useNotifications(opts: { unreadOnly?: boolean; limit?: number } = {}) {
  const query = new URLSearchParams();
  if (opts.unreadOnly) query.set("unreadOnly", "true");
  if (opts.limit) query.set("limit", String(opts.limit));

  return useQuery({
    queryKey: ["notifications", opts],
    queryFn: async () => {
      const q = query.toString();
      const res = await apiFetch<{ notifications: NotificationDTO[] }>(`/api/notifications${q ? `?${q}` : ""}`);
      return res.notifications;
    },
    refetchInterval: 30_000,
  });
}

export function useUnreadNotificationCount() {
  return useQuery({
    queryKey: ["notifications", "unread-count"],
    queryFn: async () => {
      const res = await apiFetch<{ count: number }>("/api/notifications/unread-count");
      return res.count;
    },
    refetchInterval: 20_000,
    refetchIntervalInBackground: false,
  });
}

export function useMarkNotificationRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch<{ notification: NotificationDTO }>(`/api/notifications/${id}/read`, { method: "PATCH" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notifications"] });
    },
  });
}

export function useMarkAllNotificationsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<{ ok: boolean }>("/api/notifications/mark-all-read", { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notifications"] });
    },
  });
}

export function useDeleteNotification() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch<{ ok: boolean }>(`/api/notifications/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notifications"] });
    },
  });
}

export function useNotificationSettings() {
  return useQuery({
    queryKey: ["notifications", "settings"],
    queryFn: async () => {
      const res = await apiFetch<{ settings: NotificationSettingsDTO }>("/api/notifications/settings");
      return res.settings;
    },
  });
}

export function useUpdateNotificationSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (settings: Partial<NotificationSettingsDTO>) =>
      apiFetch<{ settings: NotificationSettingsDTO }>("/api/notifications/settings", {
        method: "PATCH",
        body: JSON.stringify(settings),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notifications", "settings"] });
    },
  });
}
