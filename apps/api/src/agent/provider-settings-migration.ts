import { eq } from "drizzle-orm";
import { aiProviders, aiProviderSettings } from "../db/schema";
import { defaultProviderName } from "./provider-settings-helpers";
import type { ProviderKind, ProviderSettingsCtx } from "./provider-settings-types";

/** Ensure legacy row is migrated into ai_providers if ai_providers is empty for this user */
export async function ensureMigrated(ctx: ProviderSettingsCtx, userId: string): Promise<void> {
  const existing = await ctx.db.select({ id: aiProviders.id }).from(aiProviders).where(eq(aiProviders.userId, userId)).limit(1);
  if (existing.length > 0) return;

  // Check legacy ai_provider_settings
  const [legacy] = await ctx.db.select().from(aiProviderSettings).where(eq(aiProviderSettings.userId, userId)).limit(1);
  if (!legacy) return;

  await ctx.db
    .insert(aiProviders)
    .values({
      id: legacy.kind,
      userId: legacy.userId,
      kind: legacy.kind,
      name: defaultProviderName(legacy.kind as ProviderKind),
      baseUrl: legacy.baseUrl,
      apiKeyCiphertext: legacy.apiKeyCiphertext,
      apiKeyNonce: legacy.apiKeyNonce,
      apiKeyAuthTag: legacy.apiKeyAuthTag,
      keyVersion: legacy.keyVersion,
      models: [legacy.model],
      activeModel: legacy.model,
      enabled: true,
      createdAt: legacy.createdAt,
      updatedAt: legacy.updatedAt,
    })
    .onConflictDoNothing();
}
