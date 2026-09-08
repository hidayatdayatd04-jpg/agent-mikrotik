import { and, eq, sql } from "drizzle-orm";
import { aiProviders } from "../db/schema";
import { openSecret } from "../lib/crypto";
import { AppError } from "../lib/errors";
import { ensureMigrated } from "./provider-settings-migration";
import type {
  ProviderConfigWithKey,
  ProviderKind,
  ProviderSettingsCtx,
} from "./provider-settings-types";

/** Resolve provider & decrypted key for an agent run based on requested model or provider */
export async function resolveForRun(
  ctx: ProviderSettingsCtx,
  userId: string,
  options?: { model?: string; providerId?: string },
): Promise<ProviderConfigWithKey | null> {
  await ensureMigrated(ctx, userId);
  const rows = await ctx.db
    .select()
    .from(aiProviders)
    .where(eq(aiProviders.userId, userId));

  if (rows.length === 0) {
    if (options?.providerId || options?.model) throw new AppError("VALIDATION_FAILED", "Provider/model pilihan tidak tersedia. Pilih ulang provider AI.", 422);
    return null;
  }

  let targetRow: (typeof rows)[0] | undefined;

  // 1. If providerId specified, try to find it
  if (options?.providerId) {
    targetRow = rows.find((r) => r.id === options.providerId && r.enabled);
    if (!targetRow) throw new AppError("VALIDATION_FAILED", "Provider pilihan tidak ditemukan atau dinonaktifkan. Pilih ulang provider AI.", 422);
  }

  // 2. If model specified, search among enabled providers that have this model
  if (!targetRow && options?.model) {
    targetRow = rows.find((r) => {
      if (!r.enabled) return false;
      if (r.activeModel === options.model) return true;
      try {
        const list: string[] = Array.isArray(r.models) ? (r.models as string[]) : JSON.parse(r.models as string);
        return list.includes(options.model!);
      } catch {
        return false;
      }
    });
    if (!targetRow) throw new AppError("VALIDATION_FAILED", "Model pilihan tidak tersedia pada provider aktif. Pilih ulang model AI.", 422);
  }

  // 3. Fallback: first enabled provider
  if (!targetRow) {
    targetRow = rows.find((r) => r.enabled);
  }

  // 4. If none enabled, return null
  if (!targetRow) return null;

  const chosenModel = options?.model || targetRow.activeModel;
  const registered = Array.isArray(targetRow.models) ? targetRow.models : JSON.parse(String(targetRow.models));
  if (chosenModel !== targetRow.activeModel && !registered.includes(chosenModel)) {
    throw new AppError("VALIDATION_FAILED", "Model pilihan tidak terdaftar pada provider ini.", 422);
  }

  const apiKey = openSecret(
    ctx.keyRing,
    {
      ciphertext: targetRow.apiKeyCiphertext,
      nonce: targetRow.apiKeyNonce,
      authTag: targetRow.apiKeyAuthTag,
      keyVersion: targetRow.keyVersion,
    },
    userId,
    ctx.aadId,
  );

  if (apiKey === null) {
    throw new AppError("INTERNAL_ERROR", `Dekripsi API key untuk provider ${targetRow.name} gagal.`, 500);
  }

  return {
    id: targetRow.id,
    kind: targetRow.kind as ProviderKind,
    name: targetRow.name,
    baseUrl: targetRow.baseUrl,
    model: chosenModel,
    apiKey,
    onObservation: async (observation) => {
      await ctx.db.update(aiProviders).set({
        modelLimits: sql`json_patch(coalesce(${aiProviders.modelLimits}, '{}'), ${JSON.stringify({ [chosenModel]: observation })})`,
      }).where(and(eq(aiProviders.userId, userId), eq(aiProviders.id, targetRow.id), eq(aiProviders.apiKeyCiphertext, targetRow.apiKeyCiphertext), eq(aiProviders.baseUrl, targetRow.baseUrl)));
    },
  };
}

/** Read saved credentials for model discovery, including a disabled provider. */
export async function getSavedKey(ctx: ProviderSettingsCtx, userId: string, id: string) {
  const [row] = await ctx.db.select().from(aiProviders).where(and(eq(aiProviders.userId, userId), eq(aiProviders.id, id)));
  if (!row) return null;
  const apiKey = openSecret(ctx.keyRing, { ciphertext: row.apiKeyCiphertext, nonce: row.apiKeyNonce, authTag: row.apiKeyAuthTag, keyVersion: row.keyVersion }, userId, ctx.aadId);
  if (apiKey === null) throw new AppError("INTERNAL_ERROR", "Dekripsi API key gagal.", 500);
  return { kind: row.kind, baseUrl: row.baseUrl, apiKey };
}

/** Backwards compatibility: Config for agent loop with key */
export async function getWithKey(ctx: ProviderSettingsCtx, userId: string, requestedModel?: string): Promise<ProviderConfigWithKey | null> {
  return resolveForRun(ctx, userId, { model: requestedModel });
}
