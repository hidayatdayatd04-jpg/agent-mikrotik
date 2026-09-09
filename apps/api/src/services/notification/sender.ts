import type { Database } from "../../db";
import { notifications, notificationSettings } from "../../db/schema";
import { eq } from "drizzle-orm";
import { redactText } from "../../lib/redaction";
import type { CreateNotificationInput, NotificationDTO, NotificationType, NotificationCategory } from "./types";

export interface NotifyCtx {
  db: Database;
  /** In-memory dedup tracker: key → last notification timestamp */
  lastNotified: Map<string, number>;
}

export function toDTO(row: typeof notifications.$inferSelect): NotificationDTO {
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

function dedupKey(input: CreateNotificationInput): string {
  return `${input.userId}:${input.connectionId ?? "none"}:${input.category}:${input.type}:${input.title}`;
}

export async function sendNotification(ctx: NotifyCtx, input: CreateNotificationInput): Promise<NotificationDTO | null> {
  const { db, lastNotified } = ctx;
  // Redact message to prevent credential leaks
  const safeMessage = redactText(input.message);
  const safeTitle = redactText(input.title);

  // Deduplication check
  const key = dedupKey(input);
  const cooldown = await getCooldownMs(ctx, input.userId);
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

async function getCooldownMs(ctx: NotifyCtx, userId: string): Promise<number> {
  const [settings] = await ctx.db
    .select({ cooldownMs: notificationSettings.cooldownMs })
    .from(notificationSettings)
    .where(eq(notificationSettings.userId, userId))
    .limit(1);
  return settings?.cooldownMs ?? 300_000; // 5 min default
}
