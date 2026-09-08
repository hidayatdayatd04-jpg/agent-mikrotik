import type { Database } from "../db";
import { notifications, notificationSettings } from "../db/schema";
import { eq, and, desc, lt, sql } from "drizzle-orm";
import { redactText } from "../lib/redaction";

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

export function createNotificationService(deps: { db: Database }) {
  const { db } = deps;

  // In-memory dedup tracker: key → last notification timestamp
  const lastNotified = new Map<string, number>();

  function dedupKey(input: CreateNotificationInput): string {
    return `${input.userId}:${input.connectionId ?? "none"}:${input.category}:${input.type}:${input.title}`;
  }

  async function getCooldownMs(userId: string): Promise<number> {
    const [settings] = await db
      .select({ cooldownMs: notificationSettings.cooldownMs })
      .from(notificationSettings)
      .where(eq(notificationSettings.userId, userId))
      .limit(1);
    return settings?.cooldownMs ?? 300_000; // 5 min default
  }

  async function create(input: CreateNotificationInput): Promise<NotificationDTO | null> {
    // Redact message to prevent credential leaks
    const safeMessage = redactText(input.message);
    const safeTitle = redactText(input.title);

    // Deduplication check
    const key = dedupKey(input);
    const cooldown = await getCooldownMs(input.userId);
    const lastTime = lastNotified.get(key);
    if (lastTime && Date.now() - lastTime < cooldown) {
      return null; // Skip duplicate within cooldown window
    }

    const [row] = await db
      .insert(notifications)
      .values({
        userId: input.userId,
        connectionId: input.connectionId ?? null,
        type: input.type,
        category: input.category,
        title: safeTitle,
        message: safeMessage,
        routerLabel: input.routerLabel ?? null,
      })
      .returning();

    lastNotified.set(key, Date.now());

    // Clean up old entries in dedup map (keep only recent 1000)
    if (lastNotified.size > 1000) {
      const entries = [...lastNotified.entries()].sort((a, b) => b[1] - a[1]);
      lastNotified.clear();
      for (const [k, v] of entries.slice(0, 500)) lastNotified.set(k, v);
    }

    if (!row) return null;
    return toDTO(row);
  }

  async function list(userId: string, opts: { unreadOnly?: boolean; limit?: number; offset?: number } = {}) {
    const limit = Math.min(opts.limit ?? 50, 200);
    const offset = opts.offset ?? 0;
    const conditions = [eq(notifications.userId, userId)];
    if (opts.unreadOnly) conditions.push(eq(notifications.read, false));

    const rows = await db
      .select()
      .from(notifications)
      .where(and(...conditions))
      .orderBy(desc(notifications.createdAt))
      .limit(limit)
      .offset(offset);

    return rows.map(toDTO);
  }

  async function unreadCount(userId: string): Promise<number> {
    const [result] = await db
      .select({ count: sql<number>`count(*)` })
      .from(notifications)
      .where(and(eq(notifications.userId, userId), eq(notifications.read, false)));
    return result?.count ?? 0;
  }

  async function markRead(userId: string, notificationId: string) {
    await db
      .update(notifications)
      .set({ read: true, readAt: new Date() })
      .where(and(eq(notifications.id, notificationId), eq(notifications.userId, userId)));
  }

  async function markAllRead(userId: string) {
    await db
      .update(notifications)
      .set({ read: true, readAt: new Date() })
      .where(and(eq(notifications.userId, userId), eq(notifications.read, false)));
  }

  async function remove(userId: string, notificationId: string) {
    await db
      .delete(notifications)
      .where(and(eq(notifications.id, notificationId), eq(notifications.userId, userId)));
  }

  async function getSettings(userId: string) {
    const [row] = await db
      .select()
      .from(notificationSettings)
      .where(eq(notificationSettings.userId, userId))
      .limit(1);
    if (!row) {
      return {
        cpuThreshold: 90,
        ramThreshold: 85,
        cooldownMs: 300_000,
        enabledCategories: ["router_status", "resource", "interface", "backup", "config", "agent"],
      };
    }
    return {
      cpuThreshold: row.cpuThreshold,
      ramThreshold: row.ramThreshold,
      cooldownMs: row.cooldownMs,
      enabledCategories: row.enabledCategories as string[],
    };
  }

  async function updateSettings(userId: string, input: Partial<{
    cpuThreshold: number;
    ramThreshold: number;
    cooldownMs: number;
    enabledCategories: string[];
  }>) {
    await db
      .insert(notificationSettings)
      .values({
        userId,
        cpuThreshold: input.cpuThreshold ?? 90,
        ramThreshold: input.ramThreshold ?? 85,
        cooldownMs: input.cooldownMs ?? 300_000,
        enabledCategories: input.enabledCategories ?? ["router_status", "resource", "interface", "backup", "config", "agent"],
      })
      .onConflictDoUpdate({
        target: notificationSettings.userId,
        set: {
          ...(input.cpuThreshold !== undefined && { cpuThreshold: input.cpuThreshold }),
          ...(input.ramThreshold !== undefined && { ramThreshold: input.ramThreshold }),
          ...(input.cooldownMs !== undefined && { cooldownMs: input.cooldownMs }),
          ...(input.enabledCategories !== undefined && { enabledCategories: input.enabledCategories }),
          updatedAt: new Date(),
        },
      });
  }

  async function cleanup() {
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    await db.delete(notifications).where(lt(notifications.createdAt, cutoff));
  }

  function toDTO(row: typeof notifications.$inferSelect): NotificationDTO {
    return {
      id: row.id,
      type: row.type as NotificationType,
      category: row.category as NotificationCategory,
      title: row.title,
      message: row.message,
      read: row.read,
      routerLabel: row.routerLabel,
      connectionId: row.connectionId,
      createdAt: row.createdAt.toISOString(),
      readAt: row.readAt?.toISOString() ?? null,
    };
  }

  return { create, list, unreadCount, markRead, markAllRead, remove, delete: remove, getSettings, updateSettings, cleanup };
}

export type NotificationService = ReturnType<typeof createNotificationService>;
