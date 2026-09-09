import { eq } from "drizzle-orm";
import { notificationSettings } from "../../db/schema";
import type { NotifyCtx } from "./sender";
import type { NotificationSettingsInput } from "./types";

const DEFAULT_CATEGORIES = ["router_status", "resource", "interface", "backup", "config", "agent"];

export async function getNotificationSettings(ctx: NotifyCtx, userId: string) {
  const [row] = await ctx.db
    .select()
    .from(notificationSettings)
    .where(eq(notificationSettings.userId, userId))
    .limit(1);
  if (!row) {
    return {
      cpuThreshold: 90,
      ramThreshold: 85,
      cooldownMs: 300_000,
      enabledCategories: DEFAULT_CATEGORIES,
    };
  }
  return {
    cpuThreshold: row.cpuThreshold,
    ramThreshold: row.ramThreshold,
    cooldownMs: row.cooldownMs,
    enabledCategories: row.enabledCategories as string[],
  };
}

export async function updateNotificationSettings(ctx: NotifyCtx, userId: string, input: Partial<NotificationSettingsInput>) {
  await ctx.db
    .insert(notificationSettings)
    .values({
      userId,
      cpuThreshold: input.cpuThreshold ?? 90,
      ramThreshold: input.ramThreshold ?? 85,
      cooldownMs: input.cooldownMs ?? 300_000,
      enabledCategories: input.enabledCategories ?? DEFAULT_CATEGORIES,
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
