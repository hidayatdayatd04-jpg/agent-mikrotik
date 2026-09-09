import { config, db, keyRing, logger, rosetta, supervisor } from "./foundation";
import { catalogSource, connectors, dispatcher, networkMap, txCoordinator } from "./policy";
import { createProviderSettingsService } from "../agent/provider-settings";
import type { ProviderConfigWithKey } from "../agent/provider-settings";
import { createOpenAiCompatibleClient } from "../agent/chat-client";
import { createAgentLoop } from "../agent/loop";
import { RunEventHub } from "../agent/hub";
import { createToolExecutor } from "../agent/tool-executor";
import { executeWebSearchTool } from "../agent/web-search-tool";
import { createWebSearchSettingsService } from "../agent/web-search-settings";
import { globalCheckpoints, globalRateLimiter } from "../agent/rate-limiter";
import { parseRateLimitOverrides } from "../lib/config";
import { createFallbackChatClient, type FallbackCandidate } from "../agent/model-fallback";

// M7: AI provider (multi-provider OpenAI-compatible; Gemini/OpenRouter/custom
// per user; mock deterministik bila belum dikonfigurasi).
export const providerSettings = createProviderSettingsService({ db, keyRing, logger });
// Rate limiter terpusat untuk seluruh model/provider (chat, retry, background).
{
  const overrides = parseRateLimitOverrides(config.RATE_LIMIT_OVERRIDES_JSON);
  globalRateLimiter.setDefaults({ rpm: config.RATE_LIMIT_RPM, tpm: config.RATE_LIMIT_TPM });
  globalRateLimiter.setProviderOverride("gemini", { rpm: 15, tpm: 1_000_000 });
  for (const [k, v] of Object.entries(overrides.providerOverrides)) globalRateLimiter.setProviderOverride(k, v);
  for (const [k, v] of Object.entries(overrides.modelOverrides)) globalRateLimiter.setModelOverride(k, v);
  for (const [k, v] of Object.entries(overrides.sharedOverrides)) globalRateLimiter.setSharedOverride(k, v);
}

export const webSearchSettingsService = createWebSearchSettingsService({ db, keyRing, logger });

/** Bungkus client OpenAI-compatible dengan fallback antar model (read-only safe). */
export function makeRateLimitedClient(
  cfg: ProviderConfigWithKey,
  fallbackCandidates: FallbackCandidate[] = [],
  runContext?: { runId: string | null; conversationId: string | null; userId: string | null; userText: string | null; policyMode: "read-only" | "write" },
) {
  const base = (c: FallbackCandidate) => {
    // Kandidat membawa baseUrl/name sendiri bila dari fallback list; primer memakai cfg.
    const isPrimary = `${c.providerKind}:${c.model}` === `${cfg.kind}:${cfg.model}`;
    const effective = isPrimary
      ? cfg
      : {
          ...cfg,
          kind: c.providerKind as typeof cfg.kind,
          model: c.model,
          baseUrl: (c as { baseUrl?: string }).baseUrl ?? cfg.baseUrl,
          name: (c as { name?: string }).name ?? cfg.name,
          apiKey: c.apiKey ?? cfg.apiKey,
        };
    return createOpenAiCompatibleClient(effective, logger, { limiter: globalRateLimiter, temperature: config.AI_TEMPERATURE });
  };
  if (fallbackCandidates.length === 0) return base({ providerId: cfg.id ?? cfg.kind, providerKind: cfg.kind, model: cfg.model, enabled: true, apiKey: cfg.apiKey });
  const primary: FallbackCandidate = { providerId: cfg.id ?? cfg.kind, providerKind: cfg.kind, model: cfg.model, enabled: true, apiKey: cfg.apiKey };
  return createFallbackChatClient(primary, fallbackCandidates, base, { limiter: globalRateLimiter, checkpoints: globalCheckpoints, logger, runContext });
}

export const executeTool = createToolExecutor({ supervisor, connectors, logger, networkMap });

export const executeDocsTool = async (input: { fqName: string; args: unknown }): Promise<{ ok: boolean; output: string; errorCode?: string }> => {
  const rawName = input.fqName.includes(":") ? input.fqName.split(":")[1]! : input.fqName;
  try {
    const args = (input.args ?? {}) as Record<string, unknown>;
    if (rawName === "routeros_search") {
      const query = String(args.query ?? "").slice(0, 256);
      const limit = Math.min(Math.max(Number(args.limit ?? 5), 1), 10);
      const result = await rosetta.call("routeros_search", { query, limit });
      return { ok: true, output: JSON.stringify(result).slice(0, 6000) };
    }
    return { ok: false, output: `Tool dokumentasi ${rawName} tidak dikenal.`, errorCode: "TOOL_UNSUPPORTED" };
  } catch (err) {
    return { ok: false, output: err instanceof Error ? err.message : String(err), errorCode: "TOOL_FAILED" };
  }
};

// Web search executor — independen dari router (pola executeDocsTool).
export const executeWebSearchToolBound = (input: { userId: string; args: unknown }) =>
  executeWebSearchTool(
    { getApiKey: (userId: string) => webSearchSettingsService.getDecryptedKey(userId), logger },
    input,
  );

export const hub = new RunEventHub();

export const agentLoop = createAgentLoop({
  db,
  logger,
  dispatcher,
  txCoordinator,
  catalog: catalogSource,
  limits: {
    maxSteps: config.AGENT_MAX_STEPS,
    maxToolCalls: config.AGENT_MAX_TOOL_CALLS,
    runTimeoutMs: config.AGENT_RUN_TIMEOUT_MS,
    // 16k: model Gemini 2.5+/3.5 menghitung token "thinking" di dalam
    // max_tokens — 4096 habis untuk reasoning sebelum teks keluar.
    maxTokens: 16_384,
  },
});

export type { FallbackCandidate };
