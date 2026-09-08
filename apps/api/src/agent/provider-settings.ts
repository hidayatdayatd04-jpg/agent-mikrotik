import { getPublic, listFallbackCandidates } from "./provider-settings-candidates";
import { getProvider, listProviders, removeProvider, setActiveModel, toggleProvider } from "./provider-settings-crud";
import { getSavedKey, getWithKey, resolveForRun } from "./provider-settings-keys";
import { saveProvider } from "./provider-settings-save";
import type { ProviderSettingsCtx, ProviderSettingsDeps, SaveProviderInput } from "./provider-settings-types";

export { PROVIDER_KINDS } from "./provider-settings-types";
export type {
  AiProviderPublicDTO,
  ProviderConfig,
  ProviderConfigWithKey,
  ProviderFallbackCandidate,
  ProviderKind,
  ProviderSettingsDeps,
  SaveProviderInput,
} from "./provider-settings-types";
export { defaultBaseUrl, defaultProviderName } from "./provider-settings-helpers";

/**
 * Per-user AI provider settings (multi-provider with isolated databases & keys):
 * Google Gemini, OpenRouter, and Custom endpoints each have their own independent
 * database rows. API keys are sealed with AES-256-GCM using the user keyring and
 * are NEVER returned in plaintext.
 *
 * Each provider supports multiple models, an active model selector, and an On/Off toggle.
 */
export function createProviderSettingsService(deps: ProviderSettingsDeps) {
  const ctx: ProviderSettingsCtx = { ...deps, aadId: "ai-provider" };

  return {
    list: (userId: string) => listProviders(ctx, userId),
    get: (userId: string, id: string) => getProvider(ctx, userId, id),
    save: (userId: string, input: SaveProviderInput) => saveProvider(ctx, userId, input),
    toggle: (userId: string, id: string, enabled: boolean) => toggleProvider(ctx, userId, id, enabled),
    setActiveModel: (userId: string, id: string, model: string) => setActiveModel(ctx, userId, id, model),
    remove: (userId: string, id?: string) => removeProvider(ctx, userId, id),
    resolveForRun: (userId: string, options?: { model?: string; providerId?: string }) => resolveForRun(ctx, userId, options),
    getSavedKey: (userId: string, id: string) => getSavedKey(ctx, userId, id),
    getWithKey: (userId: string, requestedModel?: string) => getWithKey(ctx, userId, requestedModel),
    getPublic: (userId: string) => getPublic(ctx, userId),
    listFallbackCandidates: (userId: string, primary?: { model?: string; providerId?: string }) =>
      listFallbackCandidates(ctx, userId, primary),
  };
}

export type ProviderSettingsService = ReturnType<typeof createProviderSettingsService>;
