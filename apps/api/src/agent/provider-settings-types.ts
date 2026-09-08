import type { ModelLimitStatus } from "@shared/index";
import type { Database } from "../db";
import type { KeyRing } from "../lib/crypto";
import type { Logger } from "../lib/logger";

export const PROVIDER_KINDS = ["gemini", "openrouter", "custom"] as const;
export type ProviderKind = (typeof PROVIDER_KINDS)[number];

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

export interface ProviderFallbackCandidate {
  providerId: string;
  providerKind: ProviderKind;
  model: string;
  enabled: boolean;
  baseUrl: string;
  name: string;
  apiKey: string;
}

export interface ProviderSettingsDeps {
  db: Database;
  keyRing: KeyRing;
  logger: Logger;
}

/** Konteks internal yang dibawa antar modul (pengganti closure factory). */
export interface ProviderSettingsCtx extends ProviderSettingsDeps {
  aadId: string;
}
