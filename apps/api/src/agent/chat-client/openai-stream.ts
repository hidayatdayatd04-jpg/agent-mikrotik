import OpenAI from "openai";
import type { Logger } from "../../lib/logger";
import { AppError } from "../../lib/errors";
import type { ProviderConfigWithKey } from "../provider-settings";
import {
  estimateRequestTokens,
  globalRateLimiter,
  modelKeyFor,
  sharedKeyForApiKey,
} from "../rate-limiter";
import type {
  ChatClient,
  RateLimitedClientOptions,
} from "./types";
import { describeProviderRequest } from "./openai-diag";
import type { TurnCtx } from "./context";
import { buildGeminiAwareFetch } from "./openai-fetch";
import { toProviderError } from "./errors";
import { buildProviderMessages, buildProviderTools, type ProviderWireMessage } from "./wire";
import { acquireTurnTicket, requestTurnStream } from "./openai-turn";
import { drainTurnStream } from "./openai-deltas";
import { wrapResilientChunks } from "./openai-fetch";
import { sleepWithAbort } from "./openai-failure";

export function createOpenAiCompatibleClient(cfg: ProviderConfigWithKey, logger: Logger, opts: RateLimitedClientOptions = {}): ChatClient {
  // Normalize Gemini baseUrl: strip trailing /v1 if present to avoid path doubling with OpenAI SDK
  let normalizedBaseUrl = cfg.baseUrl.replace(/\/+$/, "");
  if (cfg.kind === "gemini" && normalizedBaseUrl.endsWith("/openai/v1")) {
    normalizedBaseUrl = normalizedBaseUrl.replace(/\/openai\/v1$/, "/openai");
  }

  const client = new OpenAI({
    apiKey: cfg.apiKey,
    baseURL: normalizedBaseUrl,
    timeout: 90_000,
    maxRetries: 0, // Surface quota errors promptly; never multiply a user's limited request.
    fetch: buildGeminiAwareFetch(cfg, logger),
  });

  const limiter = opts.limiter ?? globalRateLimiter;
  // Default 0: surfacing 429 promptly tanpa melipatgandakan request terbatas user.
  // Retry sama-model hanya bila pemanggil eksplisit meminta via opts.maxRetries
  // (mis. background task). Queue RPM/TPM + blockedUntil (Retry-After/backoff)
  // tetap berlaku untuk semua request; fallback antar model ditangani lapisan atas.
  const maxRetries = opts.maxRetries ?? 0;
  const modelKey = modelKeyFor(cfg.kind, cfg.model);
  let sharedKey: string | null = null;
  try {
    if (cfg.apiKey) sharedKey = sharedKeyForApiKey(cfg.apiKey);
  } catch {
    sharedKey = null;
  }

  return {
    modelLabel: `${cfg.kind}:${cfg.model}`,
    async *stream(input) {
      // Estimasi token input+output SEBELUM request (rolling TPM pre-check).
      const estimated = estimateRequestTokens({
        messages: input.messages.map((m) => ({ content: m.content })),
        tools: input.tools,
        maxTokens: input.maxTokens,
      });
      // Diagnostik aman per upaya request (tanpa isi pesan / kunci).
      const diag = describeProviderRequest({ messages: input.messages, tools: input.tools, maxTokens: input.maxTokens });
      const endpointHost = (() => {
        try {
          return new URL(normalizedBaseUrl).host;
        } catch {
          return "[invalid-base-url]";
        }
      })();

      // Validasi pairing tool SEBELUM antrean/kuota: payload rusak tidak
      // boleh menghabiskan kuota atau menimbulkan 400 provider.
      let wireMessages: ProviderWireMessage[];
      try {
        wireMessages = buildProviderMessages(input.messages, cfg.kind);
      } catch (err) {
        logger.warn("provider request blocked locally: invalid tool payload", {
          provider: cfg.kind,
          model: cfg.model,
          endpoint: endpointHost,
          ...diag,
          error: err instanceof Error ? err.message : String(err),
        });
        throw err;
      }
      const wireTools = buildProviderTools(input.tools);

      const ctx: TurnCtx = {
        cfg, logger, limiter, maxRetries, modelKey, sharedKey,
        normalizedBaseUrl, client, input, estimated, diag, endpointHost,
        wireMessages, wireTools,
      };

      let attempt = 0;
      for (;;) {
        try {
          const ticket = await acquireTurnTicket(ctx);
          const req = await requestTurnStream(ctx, ticket, attempt);
          if ("retryAfterMs" in req) {
            ticket.abandon();
            attempt += 1;
            await sleepWithAbort(req.retryAfterMs, input.signal);
            continue;
          }
          const outcome = yield* drainTurnStream(ctx, ticket, wrapResilientChunks(ctx, req.stream), attempt);
          if ("retryAfterMs" in outcome) {
            ticket.abandon();
            attempt += 1;
            await sleepWithAbort(outcome.retryAfterMs, input.signal);
            continue;
          }
          // Rekonsiliasi TPM: estimasi → token aktual dari respons API.
          ticket.complete(outcome.actualTokens ?? estimated);
          limiter.notifySuccess(modelKey);
          yield { type: "done", finishReason: outcome.finishReason };
          return;
        } catch (err) {
          // Retry loop hanya berlanjut via `continue`; selain itu teruskan.
          if (err instanceof AppError) throw err;
          throw toProviderError(err, cfg);
        }
      }
    },
  };
}
