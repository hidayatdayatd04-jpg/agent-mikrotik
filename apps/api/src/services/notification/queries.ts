import { and, desc, eq, lt, sql } from "drizzle-orm";
import { notifications } from "../../db/schema";
import { toDTO, type NotifyCtx } from "./sender";

export async function listNotifications(ctx: NotifyCtx, userId: string, opts: { unreadOnly?: boolean; limit?: number; offset?: number } = {}) {
  const limit = Math.min(opts.limit ?? 50, 200);
  const offset = opts.offset ?? 0;
  const conditions = [eq(notifications.userId, userId)];
  if (opts.unreadOnly) conditions.push(eq(notifications.read, false));

  const rows = await ctx.db
    .select()
    .from(notifications)
    .where(and(...conditions))
    .orderBy(desc(notifications.createdAt))
    .limit(limit)
    .offset(offset);

  return rows.map(toDTO);
}

export async function unreadNotificationCount(ctx: NotifyCtx, userId: string): Promise<number> {
  const [result] = await ctx.db
    .select({ count: sql<number>`count(*)` })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), eq(notifications.read, false)));
  return result?.count ?? 0;
}

export async function markNotificationRead(ctx: NotifyCtx, userId: string, notificationId: string) {
  await ctx.db
    .update(notifications)
    .set({ read: true, readAt: new Date() })
    .where(and(eq(notifications.id, notificationId), eq(notifications.userId, userId)));
}

export async function markAllNotificationsRead(ctx: NotifyCtx, userId: string) {
  await ctx.db
    .update(notifications)
    .set({ read: true, readAt: new Date() })
    .where(and(eq(notifications.userId, userId), eq(notifications.read, false)));
}

export async function removeNotification(ctx: NotifyCtx, userId: string, notificationId: string) {
  await ctx.db
    .delete(notifications)
    .where(and(eq(notifications.id, notificationId), eq(notifications.userId, userId)));
}

export async function cleanupNotifications(ctx: NotifyCtx) {
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  await ctx.db.delete(notifications).where(lt(notifications.createdAt, cutoff));
}
