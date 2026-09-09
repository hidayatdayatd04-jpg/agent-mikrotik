import type { Database } from "../db";
import type { NotificationSettingsInput } from "./notification/types";
import { cleanupNotifications, listNotifications, markAllNotificationsRead, markNotificationRead, removeNotification, unreadNotificationCount } from "./notification/queries";
import { sendNotification, type NotifyCtx } from "./notification/sender";
import { getNotificationSettings, updateNotificationSettings } from "./notification/settings";

export type { CreateNotificationInput, NotificationCategory, NotificationDTO, NotificationType } from "./notification/types";

export function createNotificationService(deps: { db: Database }) {
  const ctx: NotifyCtx = { db: deps.db, lastNotified: new Map<string, number>() };

  const create = (input: Parameters<typeof sendNotification>[1]) => sendNotification(ctx, input);
  const list = (userId: string, opts?: { unreadOnly?: boolean; limit?: number; offset?: number }) => listNotifications(ctx, userId, opts);
  const unreadCount = (userId: string) => unreadNotificationCount(ctx, userId);
  const markRead = (userId: string, notificationId: string) => markNotificationRead(ctx, userId, notificationId);
  const markAllRead = (userId: string) => markAllNotificationsRead(ctx, userId);
  const remove = (userId: string, notificationId: string) => removeNotification(ctx, userId, notificationId);
  const getSettings = (userId: string) => getNotificationSettings(ctx, userId);
  const updateSettings = (userId: string, input: Partial<NotificationSettingsInput>) => updateNotificationSettings(ctx, userId, input);
  const cleanup = () => cleanupNotifications(ctx);

  return { create, list, unreadCount, markRead, markAllRead, remove, delete: remove, getSettings, updateSettings, cleanup };
}

export type NotificationService = ReturnType<typeof createNotificationService>;
