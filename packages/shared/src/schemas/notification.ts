import { z } from "zod";

// ── Notification Types ────────────────────────────────────────

export const NotificationTypeSchema = z.enum(["info", "success", "warning", "critical"]);
export type NotificationType = z.infer<typeof NotificationTypeSchema>;

export const NotificationCategorySchema = z.enum([
  "router_status",
  "resource",
  "interface",
  "backup",
  "config",
  "agent",
]);
export type NotificationCategory = z.infer<typeof NotificationCategorySchema>;

export const NotificationDTOSchema = z.object({
  id: z.string().uuid(),
  type: NotificationTypeSchema,
  category: NotificationCategorySchema,
  title: z.string(),
  message: z.string(),
  read: z.boolean(),
  routerLabel: z.string().nullable(),
  connectionId: z.string().nullable(),
  createdAt: z.string().datetime(),
  readAt: z.string().datetime().nullable(),
});
export type NotificationDTO = z.infer<typeof NotificationDTOSchema>;

export const NotificationSettingsDTOSchema = z.object({
  cpuThreshold: z.number().int().min(1).max(100),
  ramThreshold: z.number().int().min(1).max(100),
  cooldownMs: z.number().int().min(1000),
  enabledCategories: z.array(NotificationCategorySchema),
});
export type NotificationSettingsDTO = z.infer<typeof NotificationSettingsDTOSchema>;
