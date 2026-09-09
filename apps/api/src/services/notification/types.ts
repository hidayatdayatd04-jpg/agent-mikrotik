export type NotificationType = "info" | "success" | "warning" | "critical";
export type NotificationCategory = "router_status" | "resource" | "interface" | "backup" | "config" | "agent";

export interface CreateNotificationInput {
  userId: string;
  connectionId?: string | null;
  type: NotificationType;
  category: NotificationCategory;
  title: string;
  message: string;
  routerLabel?: string | null;
}

export interface NotificationDTO {
  id: string;
  type: NotificationType;
  category: NotificationCategory;
  title: string;
  message: string;
  read: boolean;
  routerLabel: string | null;
  connectionId: string | null;
  createdAt: string;
  readAt: string | null;
}

export interface NotificationSettingsInput {
  cpuThreshold: number;
  ramThreshold: number;
  cooldownMs: number;
  enabledCategories: string[];
}
