import { eq } from "drizzle-orm";
import type { Database } from "../db";
import { webSearchSettings } from "../db/schema";
import { sealSecret, openSecret, type KeyRing } from "../lib/crypto";
import { AppError } from "../lib/errors";
import type { Logger } from "../lib/logger";

/**
 * Per-workspace Web Search (Tavily) settings: satu API key, disimpan
 * terenkripsi AES-256-GCM dengan keyRing yang sama dipakai kredensial router
 * dan provider AI. Tidak pernah dikembalikan dalam bentuk plaintext oleh GET.
 * Pola mengikuti provider-settings.ts (AAD mengikat ciphertext ke user+context).
 */
const AAD_ID = "web-search";

export function createWebSearchSettingsService(deps: { db: Database; keyRing: KeyRing; logger: Logger }) {
  async function getStatus(userId: string): Promise<{ configured: boolean; updatedAt: string | null }> {
    const [row] = await deps.db.select().from(webSearchSettings).where(eq(webSearchSettings.userId, userId)).limit(1);
    return { configured: !!row, updatedAt: row?.updatedAt.toISOString() ?? null };
  }

  /** Dipakai internal oleh tool executor — null bila belum dikonfigurasi. */
  async function getDecryptedKey(userId: string): Promise<string | null> {
    const [row] = await deps.db.select().from(webSearchSettings).where(eq(webSearchSettings.userId, userId)).limit(1);
    if (!row) return null;
    const key = openSecret(
      deps.keyRing,
      { ciphertext: row.apiKeyCiphertext, nonce: row.apiKeyNonce, authTag: row.apiKeyAuthTag, keyVersion: row.keyVersion },
      userId,
      AAD_ID,
    );
    if (key === null) {
      deps.logger.error("web search key decrypt failed", { userId });
      return null;
    }
    return key;
  }

  async function save(userId: string, apiKey: string): Promise<{ configured: true; updatedAt: string }> {
    const trimmed = apiKey.trim();
    if (trimmed.length < 8 || trimmed.length > 256) {
      throw new AppError("VALIDATION_FAILED", "API key Tavily tidak valid (panjang tidak wajar).", 422);
    }
    const sealed = sealSecret(deps.keyRing, trimmed, userId, AAD_ID);
    const now = new Date();
    await deps.db
      .insert(webSearchSettings)
      .values({
        userId,
        provider: "tavily",
        apiKeyCiphertext: sealed.ciphertext,
        apiKeyNonce: sealed.nonce,
        apiKeyAuthTag: sealed.authTag,
        keyVersion: sealed.keyVersion,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: webSearchSettings.userId,
        set: { apiKeyCiphertext: sealed.ciphertext, apiKeyNonce: sealed.nonce, apiKeyAuthTag: sealed.authTag, keyVersion: sealed.keyVersion, updatedAt: now },
      });
    return { configured: true, updatedAt: now.toISOString() };
  }

  async function remove(userId: string): Promise<void> {
    await deps.db.delete(webSearchSettings).where(eq(webSearchSettings.userId, userId));
  }

  return { getStatus, getDecryptedKey, save, remove };
}

export type WebSearchSettingsService = ReturnType<typeof createWebSearchSettingsService>;