import { and, eq, sql } from "drizzle-orm";
import type { ModelLimitStatus } from "@shared/index";
import type { Database } from "../db";
import { aiProviders, aiProviderSettings } from "../db/schema";
import { sealSecret, openSecret, type KeyRing, type SealedSecret } from "../lib/crypto";
import { AppError } from "../lib/errors";
import type { Logger } from "../lib/logger";

/**
 * Per-user AI provider settings (multi-provider with isolated databases & keys):
 * Google Gemini, OpenRouter, and Custom endpoints each have their own independent
 * database rows. API keys are sealed with AES-256-GCM using the user keyring and
 * are NEVER returned in plaintext.
 *
 * Each provider supports multiple models, an active model selector, and an On/Off toggle.
 */

export const PROVIDER_KINDS = ["gemini", "openrouter", "custom"] as const;
export type ProviderKind = (typeof PROVIDER_KINDS)[number];

export function defaultBaseUrl(kind: ProviderKind): string {
  switch (kind) {
    case "gemini":
      return "https://generativelanguage.googleapis.com/v1beta/openai/v1";
    case "openrouter":
      return "https://openrouter.ai/api/v1";
    case "custom":
      return "";
  }
}

export function defaultProviderName(kind: ProviderKind): string {
  switch (kind) {
    case "gemini":
      return "Google Gemini";
    case "openrouter":
      return "OpenRouter";
    case "custom":
      return "Custom Endpoint";
  }
}

export interface ProviderConfig {
  id?: string;
  kind: ProviderKind;
  name?: string;
  baseUrl: string;
  model: string;
}

export interface ProviderConfigWithKey extends ProviderConfig {
  apiKey: string;
  onObservation?: (status: ModelLimitStatus) => Promise<void>;
}

export interface AiProviderPublicDTO {
  id: string;
  kind: ProviderKind;
  name: string;
  baseUrl: string;
  models: string[];
  activeModel: string;
  enabled: boolean;
  hasKey: boolean;
  updatedAt: string;
  modelLimits?: Record<string, ModelLimitStatus>;
}

export interface SaveProviderInput {
  id?: string;
  kind: ProviderKind;
  name?: string;
  baseUrl?: string;
  apiKey?: string;
  models?: string[];
  activeModel?: string;
  model?: string; // backwards compatibility alias for activeModel
  enabled?: boolean;
}

function assertUrl(url: string): void {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      throw new Error("protocol");
    }
  } catch {
    throw new AppError("VALIDATION_FAILED", "Base URL provider tidak valid (harus http/https absolut).", 422);
  }
}

function assertModelName(model: string): void {
  if (!/^[A-Za-z0-9._:\/-]{1,255}$/.test(model)) {
    throw new AppError("VALIDATION_FAILED", `Nama model '${model}' tidak valid (hanya huruf, angka, titik, garis, titik dua, garis miring).`, 422);
  }
}

export function createProviderSettingsService(deps: { db: Database; keyRing: KeyRing; logger: Logger }) {
  const AAD_ID = "ai-provider";

  /** Ensure legacy row is migrated into ai_providers if ai_providers is empty for this user */
  async function ensureMigrated(userId: string): Promise<void> {
    const existing = await deps.db.select({ id: aiProviders.id }).from(aiProviders).where(eq(aiProviders.userId, userId)).limit(1);
    if (existing.length > 0) return;

    // Check legacy ai_provider_settings
    const [legacy] = await deps.db.select().from(aiProviderSettings).where(eq(aiProviderSettings.userId, userId)).limit(1);
    if (!legacy) return;

    await deps.db
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

  /** List all configured providers for a user (no plaintext keys) */
  async function list(userId: string): Promise<AiProviderPublicDTO[]> {
    await ensureMigrated(userId);
    const rows = await deps.db
      .select()
      .from(aiProviders)
      .where(eq(aiProviders.userId, userId));

    return rows.map((r) => {
      let modelsList: string[] = [];
      try {
        if (Array.isArray(r.models)) {
          modelsList = r.models as string[];
        } else if (typeof r.models === "string") {
          modelsList = JSON.parse(r.models);
        }
      } catch {
        modelsList = [];
      }
      if (modelsList.length === 0 && r.activeModel) {
        modelsList = [r.activeModel];
      }

      return {
        id: r.id,
        kind: r.kind as ProviderKind,
        name: r.name,
        baseUrl: r.baseUrl,
        models: modelsList,
        activeModel: r.activeModel,
        enabled: Boolean(r.enabled),
        hasKey: Boolean(r.apiKeyCiphertext),
        updatedAt: r.updatedAt.toISOString(),
        modelLimits: r.modelLimits ?? {},
      };
    });
  }

  /** Get single public provider by ID */
  async function get(userId: string, id: string): Promise<AiProviderPublicDTO | null> {
    await ensureMigrated(userId);
    const [row] = await deps.db
      .select()
      .from(aiProviders)
      .where(and(eq(aiProviders.userId, userId), eq(aiProviders.id, id)))
      .limit(1);

    if (!row) return null;

    let modelsList: string[] = [];
    try {
      if (Array.isArray(row.models)) {
        modelsList = row.models as string[];
      } else if (typeof row.models === "string") {
        modelsList = JSON.parse(row.models);
      }
    } catch {
      modelsList = [];
    }
    if (modelsList.length === 0 && row.activeModel) {
      modelsList = [row.activeModel];
    }

    return {
      id: row.id,
      kind: row.kind as ProviderKind,
      name: row.name,
      baseUrl: row.baseUrl,
      models: modelsList,
      activeModel: row.activeModel,
      enabled: Boolean(row.enabled),
      hasKey: Boolean(row.apiKeyCiphertext),
      updatedAt: row.updatedAt.toISOString(),
      modelLimits: row.modelLimits ?? {},
    };
  }

  /** Save or update a provider with its own isolated row, key, models list, and active model */
  async function save(userId: string, input: SaveProviderInput): Promise<AiProviderPublicDTO> {
    if (!PROVIDER_KINDS.includes(input.kind)) {
      throw new AppError("VALIDATION_FAILED", `Jenis provider harus salah satu dari: ${PROVIDER_KINDS.join(", ")}.`, 422);
    }

    const id = input.id?.trim() || input.kind;
    const name = input.name?.trim() || defaultProviderName(input.kind);
    const baseUrl = (input.baseUrl?.trim() || defaultBaseUrl(input.kind)).replace(/\/+$/, "");
    if (!baseUrl) throw new AppError("VALIDATION_FAILED", "Base URL wajib untuk provider custom.", 422);
    assertUrl(baseUrl);

    // Prepare models list
    let models = input.models?.map((m) => m.trim()).filter(Boolean) ?? [];
    if (models.length === 0) {
      const fallback = input.activeModel?.trim() || input.model?.trim() || "";
      if (fallback) models = [fallback];
    }
    if (models.length === 0) {
      throw new AppError("VALIDATION_FAILED", "Minimal sertakan satu model untuk provider ini.", 422);
    }
    for (const m of models) {
      assertModelName(m);
    }

    const activeModel = input.activeModel?.trim() || input.model?.trim() || models[0]!;
    assertModelName(activeModel);
    if (!models.includes(activeModel)) {
      models.unshift(activeModel);
    }

    // Check if provider already exists
    const [existing] = await deps.db
      .select()
      .from(aiProviders)
      .where(and(eq(aiProviders.userId, userId), eq(aiProviders.id, id)))
      .limit(1);

    let sealed: SealedSecret;
    if (input.apiKey && input.apiKey.trim().length > 0) {
      if (input.apiKey.length < 8) {
        throw new AppError("VALIDATION_FAILED", "API key provider wajib diisi (minimal 8 karakter).", 422);
      }
      sealed = sealSecret(deps.keyRing, input.apiKey, userId, AAD_ID);
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

    await deps.db
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
    await deps.db
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

  /** Toggle on/off for a provider */
  async function toggle(userId: string, id: string, enabled: boolean): Promise<AiProviderPublicDTO> {
    const existing = await get(userId, id);
    if (!existing) {
      throw new AppError("NOT_FOUND", "Provider tidak ditemukan.", 404);
    }
    await deps.db
      .update(aiProviders)
      .set({ enabled, updatedAt: new Date() })
      .where(and(eq(aiProviders.userId, userId), eq(aiProviders.id, id)));

    return { ...existing, enabled, updatedAt: new Date().toISOString() };
  }

  /** Set active model for a provider */
  async function setActiveModel(userId: string, id: string, model: string): Promise<AiProviderPublicDTO> {
    assertModelName(model);
    const existing = await get(userId, id);
    if (!existing) {
      throw new AppError("NOT_FOUND", "Provider tidak ditemukan.", 404);
    }
    const models = existing.models.includes(model) ? existing.models : [model, ...existing.models];
    await deps.db
      .update(aiProviders)
      .set({ activeModel: model, models, updatedAt: new Date() })
      .where(and(eq(aiProviders.userId, userId), eq(aiProviders.id, id)));

    // Update legacy table if this is the active/enabled provider
    if (existing.enabled) {
      await deps.db
        .update(aiProviderSettings)
        .set({ model, updatedAt: new Date() })
        .where(and(eq(aiProviderSettings.userId, userId), eq(aiProviderSettings.kind, existing.kind), eq(aiProviderSettings.baseUrl, existing.baseUrl)));
    }

    return { ...existing, activeModel: model, models, updatedAt: new Date().toISOString() };
  }

  /** Remove a provider by ID */
  async function remove(userId: string, id?: string) {
    if (id) {
      await deps.db.delete(aiProviders).where(and(eq(aiProviders.userId, userId), eq(aiProviders.id, id)));
      // Do not resurrect the deleted configuration from the compatibility row.
      await deps.db.delete(aiProviderSettings).where(eq(aiProviderSettings.userId, userId));
    } else {
      await deps.db.delete(aiProviders).where(eq(aiProviders.userId, userId));
      await deps.db.delete(aiProviderSettings).where(eq(aiProviderSettings.userId, userId));
    }
  }

  /** Resolve provider & decrypted key for an agent run based on requested model or provider */
  async function resolveForRun(
    userId: string,
    options?: { model?: string; providerId?: string }
  ): Promise<ProviderConfigWithKey | null> {
    await ensureMigrated(userId);
    const rows = await deps.db
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
      deps.keyRing,
      {
        ciphertext: targetRow.apiKeyCiphertext,
        nonce: targetRow.apiKeyNonce,
        authTag: targetRow.apiKeyAuthTag,
        keyVersion: targetRow.keyVersion,
      },
      userId,
      AAD_ID,
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
        await deps.db.update(aiProviders).set({
          modelLimits: sql`json_patch(coalesce(${aiProviders.modelLimits}, '{}'), ${JSON.stringify({ [chosenModel]: observation })})`,
        }).where(and(eq(aiProviders.userId, userId), eq(aiProviders.id, targetRow.id), eq(aiProviders.apiKeyCiphertext, targetRow.apiKeyCiphertext), eq(aiProviders.baseUrl, targetRow.baseUrl)));
      },
    };
  }

  /** Read saved credentials for model discovery, including a disabled provider. */
  async function getSavedKey(userId: string, id: string) {
    const [row] = await deps.db.select().from(aiProviders).where(and(eq(aiProviders.userId, userId), eq(aiProviders.id, id)));
    if (!row) return null;
    const apiKey = openSecret(deps.keyRing, { ciphertext: row.apiKeyCiphertext, nonce: row.apiKeyNonce, authTag: row.apiKeyAuthTag, keyVersion: row.keyVersion }, userId, AAD_ID);
    if (apiKey === null) throw new AppError("INTERNAL_ERROR", "Dekripsi API key gagal.", 500);
    return { kind: row.kind, baseUrl: row.baseUrl, apiKey };
  }

  /** Backwards compatibility: Config for agent loop with key */
  async function getWithKey(userId: string, requestedModel?: string): Promise<ProviderConfigWithKey | null> {
    return resolveForRun(userId, { model: requestedModel });
  }

  /** Backwards compatibility: Safe view for browser */
  async function getPublic(userId: string) {
    const listResult = await list(userId);
    const active = listResult.find((p) => p.enabled) ?? listResult[0];
    if (!active) return null;
    return {
      kind: active.kind,
      baseUrl: active.baseUrl,
      model: active.activeModel,
      hasKey: active.hasKey,
      id: active.id,
      name: active.name,
      models: active.models,
      enabled: active.enabled,
    };
  }

  /**
   * Kandidat fallback lintas provider/model (dengan key terdekripsi) untuk
   * fallback kompatibel saat primer terkena rate limit / kuota harian habis.
   * Urutan: model primer dulu (bila cocok), lalu model lain provider sama,
   * lalu provider lain. Hanya yang enabled.
   */
  async function listFallbackCandidates(
    userId: string,
    primary?: { model?: string; providerId?: string },
  ): Promise<
    {
      providerId: string;
      providerKind: ProviderKind;
      model: string;
      enabled: boolean;
      baseUrl: string;
      name: string;
      apiKey: string;
    }[]
  > {
    await ensureMigrated(userId);
    const rows = await deps.db.select().from(aiProviders).where(eq(aiProviders.userId, userId));
    const out: {
      providerId: string;
      providerKind: ProviderKind;
      model: string;
      enabled: boolean;
      baseUrl: string;
      name: string;
      apiKey: string;
    }[] = [];
    const pushRow = (row: (typeof rows)[0], modelsInOrder: string[]) => {
      if (!row.enabled) return;
      let apiKey: string | null = null;
      try {
        apiKey = openSecret(
          deps.keyRing,
          { ciphertext: row.apiKeyCiphertext, nonce: row.apiKeyNonce, authTag: row.apiKeyAuthTag, keyVersion: row.keyVersion },
          userId,
          AAD_ID,
        );
      } catch {
        return;
      }
      if (!apiKey) return;
      for (const m of modelsInOrder) {
        out.push({
          providerId: row.id,
          providerKind: row.kind as ProviderKind,
          model: m,
          enabled: true,
          baseUrl: row.baseUrl,
          name: row.name,
          apiKey,
        });
      }
    };

    // Tentukan provider target bila user meminta provider/model spesifik
    let targetProviderId = primary?.providerId;
    if (!targetProviderId && primary?.model) {
      const match = rows.find((r) => {
        if (!r.enabled) return false;
        if (r.activeModel === primary.model) return true;
        try {
          const list: string[] = Array.isArray(r.models) ? (r.models as string[]) : JSON.parse(r.models as string);
          return list.includes(primary.model!);
        } catch {
          return false;
        }
      });
      if (match) targetProviderId = match.id;
    }

    // Jika user secara spesifik memilih provider/model, isolasi kandidat HANYA pada provider tersebut
    // (jangan pernah membocorkan fallback ke provider lain yang tidak dipilih user)
    if (targetProviderId) {
      const row = rows.find((r) => r.id === targetProviderId && r.enabled);
      if (row) {
        const list: string[] = Array.isArray(row.models)
          ? (row.models as string[])
          : (() => { try { return JSON.parse(row.models as string); } catch { return [row.activeModel]; } })();
        const ordered = primary?.model
          ? [primary.model, ...list.filter((m) => m !== primary.model)]
          : [row.activeModel, ...list.filter((m) => m !== row.activeModel)];
        pushRow(row, ordered);
      }
      return out;
    }

    // Default umum jika tidak ada provider spesifik: urutkan semua provider yang enabled
    for (const r of rows) {
      if (!r.enabled) continue;
      const list: string[] = Array.isArray(r.models) ? (r.models as string[]) : (() => { try { return JSON.parse(r.models as string); } catch { return [r.activeModel]; } })();
      const ordered = [r.activeModel, ...list.filter((m) => m !== r.activeModel)];
      // Hindari duplikat modelKey yang sudah ada
      const existingKeys = new Set(out.map((c) => `${c.providerKind}:${c.model}`));
      const filtered = ordered.filter((m) => !existingKeys.has(`${r.kind}:${m}`));
      if (filtered.length > 0) pushRow(r, filtered);
    }
    return out;
  }

  return {
    list,
    get,
    save,
    toggle,
    setActiveModel,
    remove,
    resolveForRun,
    getSavedKey,
    getWithKey,
    getPublic,
    listFallbackCandidates,
  };
}

export type ProviderSettingsService = ReturnType<typeof createProviderSettingsService>;
