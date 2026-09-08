import { eq } from "drizzle-orm";
import { aiProviders } from "../db/schema";
import { openSecret } from "../lib/crypto";
import { listProviders } from "./provider-settings-crud";
import { ensureMigrated } from "./provider-settings-migration";
import type { ProviderFallbackCandidate, ProviderSettingsCtx } from "./provider-settings-types";

/** Backwards compatibility: Safe view for browser */
export async function getPublic(ctx: ProviderSettingsCtx, userId: string) {
  const listResult = await listProviders(ctx, userId);
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
export async function listFallbackCandidates(
  ctx: ProviderSettingsCtx,
  userId: string,
  primary?: { model?: string; providerId?: string },
): Promise<ProviderFallbackCandidate[]> {
  await ensureMigrated(ctx, userId);
  const rows = await ctx.db.select().from(aiProviders).where(eq(aiProviders.userId, userId));
  const out: ProviderFallbackCandidate[] = [];
  const pushRow = (row: (typeof rows)[0], modelsInOrder: string[]) => {
    if (!row.enabled) return;
    let apiKey: string | null = null;
    try {
      apiKey = openSecret(
        ctx.keyRing,
        { ciphertext: row.apiKeyCiphertext, nonce: row.apiKeyNonce, authTag: row.apiKeyAuthTag, keyVersion: row.keyVersion },
        userId,
        ctx.aadId,
      );
    } catch {
      return;
    }
    if (!apiKey) return;
    for (const m of modelsInOrder) {
      out.push({
        providerId: row.id,
        providerKind: row.kind as ProviderFallbackCandidate["providerKind"],
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
