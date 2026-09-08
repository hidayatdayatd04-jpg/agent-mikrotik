import { and, eq } from "drizzle-orm";
import { aiProviders, aiProviderSettings } from "../db/schema";
import { sealSecret, type SealedSecret } from "../lib/crypto";
import { AppError } from "../lib/errors";
import {
  assertUrl,
  buildSaveModels,
  defaultBaseUrl,
  defaultProviderName,
} from "./provider-settings-helpers";
import type { AiProviderPublicDTO, ProviderSettingsCtx, SaveProviderInput } from "./provider-settings-types";
import { PROVIDER_KINDS } from "./provider-settings-types";

/** Save or update a provider with its own isolated row, key, models list, and active model */
export async function saveProvider(ctx: ProviderSettingsCtx, userId: string, input: SaveProviderInput): Promise<AiProviderPublicDTO> {
  if (!PROVIDER_KINDS.includes(input.kind)) {
    throw new AppError("VALIDATION_FAILED", `Jenis provider harus salah satu dari: ${PROVIDER_KINDS.join(", ")}.`, 422);
  }

  const id = input.id?.trim() || input.kind;
  const name = input.name?.trim() || defaultProviderName(input.kind);
  const baseUrl = (input.baseUrl?.trim() || defaultBaseUrl(input.kind)).replace(/\/+$/, "");
  if (!baseUrl) throw new AppError("VALIDATION_FAILED", "Base URL wajib untuk provider custom.", 422);
  assertUrl(baseUrl);

  // Prepare models list
  const { models, activeModel } = buildSaveModels(input);

  // Check if provider already exists
  const [existing] = await ctx.db
    .select()
    .from(aiProviders)
    .where(and(eq(aiProviders.userId, userId), eq(aiProviders.id, id)))
    .limit(1);

  let sealed: SealedSecret;
  if (input.apiKey && input.apiKey.trim().length > 0) {
    if (input.apiKey.length < 8) {
      throw new AppError("VALIDATION_FAILED", "API key provider wajib diisi (minimal 8 karakter).", 422);
    }
    sealed = sealSecret(ctx.keyRing, input.apiKey, userId, ctx.aadId);
  } else if (existing?.apiKeyCiphertext) {
    // Retain existing key
    sealed = {
      ciphertext: existing.apiKeyCiphertext,
      nonce: existing.apiKeyNonce,
      authTag: existing.apiKeyAuthTag,
      keyVersion: existing.keyVersion,
    };
  } else {
    throw new AppError("VALIDATION_FAILED", "API key provider wajib diisi untuk provider baru.", 422);
  }

  const enabled = input.enabled !== undefined ? input.enabled : (existing ? Boolean(existing.enabled) : true);

  await ctx.db
    .insert(aiProviders)
    .values({
      id,
      userId,
      kind: input.kind,
      name,
      baseUrl,
      apiKeyCiphertext: sealed.ciphertext,
      apiKeyNonce: sealed.nonce,
      apiKeyAuthTag: sealed.authTag,
      keyVersion: sealed.keyVersion,
      models,
      activeModel,
      enabled,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: aiProviders.id,
      set: {
        name,
        baseUrl,
        modelLimits: input.apiKey?.trim() || existing?.baseUrl !== baseUrl ? null : existing?.modelLimits,
        apiKeyCiphertext: sealed.ciphertext,
        apiKeyNonce: sealed.nonce,
        apiKeyAuthTag: sealed.authTag,
        keyVersion: sealed.keyVersion,
        models,
        activeModel,
        enabled,
        updatedAt: new Date(),
      },
    });

  // Also update legacy ai_provider_settings for backwards compatibility
  await ctx.db
    .insert(aiProviderSettings)
    .values({
      userId,
      kind: input.kind,
      baseUrl,
      model: activeModel,
      apiKeyCiphertext: sealed.ciphertext,
      apiKeyNonce: sealed.nonce,
      apiKeyAuthTag: sealed.authTag,
      keyVersion: sealed.keyVersion,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: aiProviderSettings.userId,
      set: {
        kind: input.kind,
        baseUrl,
        model: activeModel,
        apiKeyCiphertext: sealed.ciphertext,
        apiKeyNonce: sealed.nonce,
        apiKeyAuthTag: sealed.authTag,
        keyVersion: sealed.keyVersion,
        updatedAt: new Date(),
      },
    });

  return {
    id,
    kind: input.kind,
    name,
    baseUrl,
    models,
    activeModel,
    enabled,
    hasKey: true,
    updatedAt: new Date().toISOString(),
  };
}
