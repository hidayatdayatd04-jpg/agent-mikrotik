import { and, eq } from "drizzle-orm";
import { aiProviders, aiProviderSettings } from "../db/schema";
import { AppError } from "../lib/errors";
import { assertModelName, toPublicDTO } from "./provider-settings-helpers";
import { ensureMigrated } from "./provider-settings-migration";
import type { AiProviderPublicDTO, ProviderSettingsCtx } from "./provider-settings-types";

/** List all configured providers for a user (no plaintext keys) */
export async function listProviders(ctx: ProviderSettingsCtx, userId: string): Promise<AiProviderPublicDTO[]> {
  await ensureMigrated(ctx, userId);
  const rows = await ctx.db
    .select()
    .from(aiProviders)
    .where(eq(aiProviders.userId, userId));

  return rows.map((r) => toPublicDTO(r));
}

/** Get single public provider by ID */
export async function getProvider(ctx: ProviderSettingsCtx, userId: string, id: string): Promise<AiProviderPublicDTO | null> {
  await ensureMigrated(ctx, userId);
  const [row] = await ctx.db
    .select()
    .from(aiProviders)
    .where(and(eq(aiProviders.userId, userId), eq(aiProviders.id, id)))
    .limit(1);

  if (!row) return null;
  return toPublicDTO(row);
}

/** Toggle on/off for a provider */
export async function toggleProvider(ctx: ProviderSettingsCtx, userId: string, id: string, enabled: boolean): Promise<AiProviderPublicDTO> {
  const existing = await getProvider(ctx, userId, id);
  if (!existing) {
    throw new AppError("NOT_FOUND", "Provider tidak ditemukan.", 404);
  }
  await ctx.db
    .update(aiProviders)
    .set({ enabled, updatedAt: new Date() })
    .where(and(eq(aiProviders.userId, userId), eq(aiProviders.id, id)));

  return { ...existing, enabled, updatedAt: new Date().toISOString() };
}

/** Set active model for a provider */
export async function setActiveModel(ctx: ProviderSettingsCtx, userId: string, id: string, model: string): Promise<AiProviderPublicDTO> {
  assertModelName(model);
  const existing = await getProvider(ctx, userId, id);
  if (!existing) {
    throw new AppError("NOT_FOUND", "Provider tidak ditemukan.", 404);
  }
  const models = existing.models.includes(model) ? existing.models : [model, ...existing.models];
  await ctx.db
    .update(aiProviders)
    .set({ activeModel: model, models, updatedAt: new Date() })
    .where(and(eq(aiProviders.userId, userId), eq(aiProviders.id, id)));

  // Update legacy table if this is the active/enabled provider
  if (existing.enabled) {
    await ctx.db
      .update(aiProviderSettings)
      .set({ model, updatedAt: new Date() })
      .where(and(eq(aiProviderSettings.userId, userId), eq(aiProviderSettings.kind, existing.kind), eq(aiProviderSettings.baseUrl, existing.baseUrl)));
  }

  return { ...existing, activeModel: model, models, updatedAt: new Date().toISOString() };
}

/** Remove a provider by ID */
export async function removeProvider(ctx: ProviderSettingsCtx, userId: string, id?: string) {
  if (id) {
    await ctx.db.delete(aiProviders).where(and(eq(aiProviders.userId, userId), eq(aiProviders.id, id)));
    // Do not resurrect the deleted configuration from the compatibility row.
    await ctx.db.delete(aiProviderSettings).where(eq(aiProviderSettings.userId, userId));
  } else {
    await ctx.db.delete(aiProviders).where(eq(aiProviders.userId, userId));
    await ctx.db.delete(aiProviderSettings).where(eq(aiProviderSettings.userId, userId));
  }
}
