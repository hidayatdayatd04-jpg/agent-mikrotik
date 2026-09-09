import { z } from "zod";
import type { ProviderSettingsService } from "../../agent/provider-settings";
import type { Logger } from "../../lib/logger";
import type { CentralRateLimiter, CheckpointStore } from "../../agent/rate-limiter";

export interface AiProviderRouteDeps {
  providers: ProviderSettingsService;
  logger: Logger;
  limiter?: CentralRateLimiter;
  checkpoints?: CheckpointStore;
}

/** Konteks route yang dibawa antar modul (pengganti closure factory). */
export interface AiProviderRouteCtx {
  deps: AiProviderRouteDeps;
  modelCache: Map<string, { until: number; value: Record<string, unknown> }>;
}

export const SaveSchema = z.object({
  id: z.string().max(64).optional(),
  kind: z.enum(["gemini", "openrouter", "custom"]),
  name: z.string().max(128).optional(),
  baseUrl: z.string().max(512).optional(),
  apiKey: z.string().min(8).max(512).optional(),
  models: z.array(z.string().min(1).max(255)).optional(),
  activeModel: z.string().min(1).max(255).optional(),
  model: z.string().min(1).max(255).optional(), // legacy alias
  enabled: z.boolean().optional(),
});

export const ToggleSchema = z.object({
  enabled: z.boolean(),
});

export const SetActiveModelSchema = z.object({
  model: z.string().min(1).max(255),
});

export const FetchModelsSchema = z.object({
  providerId: z.string().max(64).optional(),
  kind: z.enum(["gemini", "openrouter", "custom"]),
  baseUrl: z.string().max(512).optional(),
  apiKey: z.string().min(8).max(512).optional(),
});

export const OverrideSchema = z.object({
  scope: z.enum(["provider", "model", "shared"]),
  key: z.string().min(1).max(255),
  rpm: z.number().int().min(1).max(1000).optional(),
  tpm: z.number().int().min(1000).max(10000000).optional(),
});
