import { eq } from "drizzle-orm";
import type { Database } from "../db";
import { aiProviderSettings } from "../db/schema";
import { sealSecret, openSecret, type KeyRing, type SealedSecret } from "../lib/crypto";
import { AppError } from "../lib/errors";
import type { Logger } from "../lib/logger";

/**
 * Per-user AI provider settings (M7 revision): OpenAI-compatible providers —
 * Google Gemini, OpenRouter, or a custom endpoint. The API key is sealed with
 * the same AES-256-GCM keyRing used for router credentials and is NEVER
 * returned in plaintext by any API response.
 */

export const PROVIDER_KINDS = ["gemini", "openrouter", "custom"] as const;
export type ProviderKind = (typeof PROVIDER_KINDS)[number];

/** Canonical OpenAI-compatible base URLs for the well-known kinds. */
export function defaultBaseUrl(kind: ProviderKind): string {
  switch (kind) {
    case "gemini":
      // Google's official OpenAI-compatibility endpoint
      return "https://generativelanguage.googleapis.com/v1beta/openai/v1";
    case "openrouter":
      return "https://openrouter.ai/api/v1";
    case "custom":
      return "";
  }
}

export interface ProviderConfig {
  kind: ProviderKind;
  baseUrl: string;
  model: string;
}

export interface ProviderConfigWithKey extends ProviderConfig {
  apiKey: string;
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
    throw new AppError("VALIDATION_FAILED", "Nama model hanya boleh huruf, angka, titik, garis, titik dua, garis miring.", 422);
  }
}

export function createProviderSettingsService(deps: { db: Database; keyRing: KeyRing; logger: Logger }) {
  const AAD_ID = "ai-provider";

  async function save(userId: string, input: { kind: ProviderKind; baseUrl?: string; model: string; apiKey: string }) {
    if (!PROVIDER_KINDS.includes(input.kind)) {
      throw new AppError("VALIDATION_FAILED", `Jenis provider harus salah dari: ${PROVIDER_KINDS.join(", ")}.`, 422);
    }
    const baseUrl = (input.baseUrl?.trim() || defaultBaseUrl(input.kind)).replace(/\/+$/, "");
    if (!baseUrl) throw new AppError("VALIDATION_FAILED", "Base URL wajib untuk provider custom.", 422);
    assertUrl(baseUrl);
    if (!input.apiKey || input.apiKey.length < 8) {
      throw new AppError("VALIDATION_FAILED", "API key provider wajib diisi (minimal 8 karakter).", 422);
    }
    assertModelName(input.model);

    const sealed: SealedSecret = sealSecret(deps.keyRing, input.apiKey, userId, AAD_ID);
    await deps.db
      .insert(aiProviderSettings)
      .values({
        userId,
        kind: input.kind,
        baseUrl,
        model: input.model,
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
          model: input.model,
          apiKeyCiphertext: sealed.ciphertext,
          apiKeyNonce: sealed.nonce,
          apiKeyAuthTag: sealed.authTag,
          keyVersion: sealed.keyVersion,
          updatedAt: new Date(),
        },
      });
    return { kind: input.kind, baseUrl, model: input.model };
  }

  /** Config for the agent loop — includes the decrypted key, backend-only. */
  async function getWithKey(userId: string): Promise<ProviderConfigWithKey | null> {
    const [row] = await deps.db.select().from(aiProviderSettings).where(eq(aiProviderSettings.userId, userId)).limit(1);
    if (!row) return null;
    const apiKey = openSecret(
      deps.keyRing,
      { ciphertext: row.apiKeyCiphertext, nonce: row.apiKeyNonce, authTag: row.apiKeyAuthTag, keyVersion: row.keyVersion },
      userId,
      AAD_ID,
    );
    if (apiKey === null) {
      throw new AppError("INTERNAL_ERROR", "Dekripsi API key provider gagal (key rotated?).", 500);
    }
    return { kind: row.kind as ProviderKind, baseUrl: row.baseUrl, model: row.model, apiKey };
  }

  /** Safe view for the browser — no key material. */
  async function getPublic(userId: string) {
    const [row] = await deps.db.select().from(aiProviderSettings).where(eq(aiProviderSettings.userId, userId)).limit(1);
    if (!row) return null;
    return { kind: row.kind, baseUrl: row.baseUrl, model: row.model, hasKey: true };
  }

  async function remove(userId: string) {
    await deps.db.delete(aiProviderSettings).where(eq(aiProviderSettings.userId, userId));
  }

  return { save, getWithKey, getPublic, remove };
}

export type ProviderSettingsService = ReturnType<typeof createProviderSettingsService>;
