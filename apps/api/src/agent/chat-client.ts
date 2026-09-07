import OpenAI from "openai";
import type { Logger } from "../lib/logger";
import { AppError } from "../lib/errors";
import type { ProviderConfigWithKey } from "./provider-settings";
import { observeProviderResponse, isDailyQuotaError } from "./provider-limits";
import {
  CentralRateLimiter,
  classifyQuotaError,
  computeBackoffWithJitter,
  estimateRequestTokens,
  globalRateLimiter,
  modelKeyFor,
  nextMidnightUtcMs,
  parseRetryAfterMs,
  sharedKeyForApiKey,
} from "./rate-limiter";
import { redactText } from "../lib/redaction";

/**
 * Unified streaming chat interface for the agent loop, so the loop code is
 * provider-agnostic. Two implementations:
 *  - OpenAiCompatibleClient: real requests via the `openai` SDK against
 *    Gemini / OpenRouter / custom endpoints (user-configured).
 *  - MockProviderClient: deterministic responses for dev/test without any
 *    credentials — never claimed as a real integration.
 */

export interface ChatToolDefinition {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface ChatToolCall {
  id: string;
  name: string;
  argumentsJson: string;
  extraContent?: unknown;
}

export interface StreamEvent {
  type: "text" | "tool_calls" | "done" | "usage";
  text?: string;
  toolCalls?: ChatToolCall[];
  finishReason?: string;
  usage?: { promptTokens: number; completionTokens: number };
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  toolCalls?: ChatToolCall[];
  toolCallId?: string;
}

export interface ChatClient {
  /** Streams one assistant turn; yields text deltas then tool_calls. */
  stream(input: {
    messages: ChatMessage[];
    tools: ChatToolDefinition[];
    maxTokens: number;
    signal?: AbortSignal;
    /** Dipanggil setiap upaya HTTP ke provider (termasuk retry). Untuk pencatatan jumlah request AI. */
    onRequestAttempt?: () => void;
  }): AsyncGenerator<StreamEvent>;
  modelLabel: string;
}

/** Translates an OpenAI SDK error into a typed AppError with an actionable message. */
export function toProviderError(err: unknown, cfg: ProviderConfigWithKey): AppError {
  const apiErr = err as { status?: number; message?: string; code?: string; headers?: Headers | Record<string, string>; error?: { message?: string; code?: string | number } } | null;
  const status = typeof apiErr?.status === "number" ? apiErr.status : 0;
  const raw = redactText(String(apiErr?.error?.message || apiErr?.message || (err instanceof Error ? err.message : String(err))).split(cfg.apiKey).join("[REDACTED]"));
  if (err instanceof AppError) return err;

  // Detect rate limit / quota exceeded from message even if status code differs
  const isQuota = status === 429 || apiErr?.error?.code === 429 || (status === 0 && /resource_exhausted|rate limit exceeded|quota exceeded/i.test(raw));

  if (isQuota) {
    // Extract retry delay if available in message (e.g. "Please retry in 11.4s")
    const retryMatch = raw.match(/retry in\s+([\d.]+s?)/i);
    const retryNote = retryMatch ? ` Silakan tunggu ${retryMatch[1]} sebelum mencoba lagi.` : "";
    if (isDailyQuotaError(status === 0 ? 429 : status, raw)) {
      return new AppError(
        "UPSTREAM_QUOTA_EXHAUSTED",
        `Kuota harian provider habis (429) pada ${cfg.name ?? cfg.kind} / ${cfg.model}.${retryNote} Penggunaan model ini dihentikan sementara sampai kuota tersedia kembali; sistem akan memakai model cadangan bila tersedia. Permintaan ini tidak di-retry. Detail: ${raw.slice(0, 300)}`,
        502,
      );
    }
    return new AppError(
      "UPSTREAM_RATE_LIMITED",
      `Rate limit provider tercapai (429) pada ${cfg.name ?? cfg.kind} / ${cfg.model}.${retryNote} Batas dapat berlaku bersama pada akun/project; mengganti model belum tentu mereset kuota. Lihat status limit di Provider AI. Detail: ${raw.slice(0, 300)}`,
      502,
    );
  }
  if (status === 401 || status === 403) {
    return new AppError("UPSTREAM_AUTH_FAILED", `Provider menolak kredensial (${status}). Periksa API Key di menu Pengaturan. Detail: ${raw.slice(0, 250)}`, 400);
  }
  if (status === 404) {
    return new AppError("UPSTREAM_ERROR", `Nama model tidak ditemukan pada provider (404). Periksa Nama Model di menu Pengaturan atau klik "Ambil Daftar Model". Detail: ${raw.slice(0, 250)}`, 502);
  }
  if (status === 400) {
    return new AppError(
      "UPSTREAM_INVALID_REQUEST",
      `Permintaan ditolak oleh provider AI (400, argumen tidak valid) pada ${cfg.name ?? cfg.kind} / ${cfg.model}. ` +
        `Ini kesalahan format permintaan, bukan kuota — tidak di-retry agar kuota tidak terbuang. Detail: ${raw.slice(0, 300)}`,
      502,
    );
  }
  if (status >= 500) {
    return new AppError("UPSTREAM_ERROR", `Provider mengalami gangguan (${status}). Coba lagi sebentar. Detail: ${raw.slice(0, 250)}`, 502);
  }
  if (apiErr?.code === "ECONNREFUSED" || apiErr?.code === "ENOTFOUND" || apiErr?.code === "EAI_AGAIN") {
    return new AppError("UPSTREAM_ERROR", `Tidak dapat terhubung ke provider (${apiErr.code}). Periksa Base URL di menu Pengaturan.`, 502);
  }
  const timedOut = err instanceof Error && /timeout|timed out/i.test(err.message);
  if (timedOut || apiErr?.code === "ETIMEDOUT" || apiErr?.code === "ABORT_ERR") {
    return new AppError("UPSTREAM_TIMEOUT", "Provider tidak merespons dalam batas waktu.", 504);
  }
  return new AppError("UPSTREAM_ERROR", `Gagal berkomunikasi dengan provider AI. Detail: ${raw.slice(0, 250)}`, 502);
}

export interface RateLimitedClientOptions {
  limiter?: CentralRateLimiter;
  /** Batas retry untuk 429 rate-limit biasa (bukan kuota harian). Default dari limiter. */
  maxRetries?: number;
}

/**
 * Bentuk wire OpenAI-compatible yang dikirim ke provider.
 * `content` SELALU string (tidak pernah null): endpoint OpenAI-compatible
 * Gemini (`/v1beta/openai/`) menolak `content: null` pada giliran
 * assistant+tool_calls dengan 400 "Request contains an invalid argument".
 * Itulah akar 400 pada alur satu-tool: request pertama (tanpa tool turn)
 * lolos, request kedua (assistant null + tool result) ditolak.
 */
export interface ProviderWireMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string }; extra_content?: unknown }[];
  tool_call_id?: string;
}

/**
 * Normalisasi pesan internal → payload provider yang valid lintas
 * Gemini native-via-OpenAI-compat, OpenAI-compatible, dan OpenRouter:
 *  - system non-pertama → user berprefix (Gemini hanya menerima satu
 *    system instruction di awal; system di tengah percakapan → 400).
 *  - assistant+tool_calls dengan content null/kosong → "" (Gemini menolak null).
 *  - extra_content hanya diteruskan ke Gemini (field non-standar; provider
 *    ketat lain menolak field tak dikenal dengan 400).
 *  - tool tanpa tool_call_id / content non-string diperbaiki atau ditolak
 *    sebelum request dikirim (hemat kuota: tanpa.compose doomed request).
 *
 * Melempar AppError VALIDATION_FAILED bila pasangan assistant(tool_calls)
 * ↔ tool result rusak — tanpa menyentuh kuota provider.
 */
export function buildProviderMessages(
  messages: ChatMessage[],
  providerKind: string,
): ProviderWireMessage[] {
  const declared = new Map<string, number>(); // tool_call id → index pesan assistant
  const answered = new Map<string, number>(); // tool_call id → index pesan tool
  const out: ProviderWireMessage[] = [];
  let seenFirstSystem = false;

  messages.forEach((m, idx) => {
    if (m.role === "system" && seenFirstSystem) {
      out.push({ role: "user", content: `[Catatan sistem] ${m.content ?? ""}` });
      return;
    }
    if (m.role === "system") {
      seenFirstSystem = true;
      out.push({ role: "system", content: m.content ?? "" });
      return;
    }
    if (m.role === "tool") {
      const id = (m.toolCallId ?? "").trim();
      if (!id) {
        throw new AppError("VALIDATION_FAILED", `Payload tool rusak (pesan ${idx}): tool_call_id kosong — request dibatalkan sebelum menghabiskan kuota.`, 422);
      }
      if (answered.has(id)) {
        throw new AppError("VALIDATION_FAILED", `Payload tool rusak: tool_call_id "${id}" dijawab dua kali — request dibatalkan sebelum menghabiskan kuota.`, 422);
      }
      answered.set(id, idx);
      out.push({ role: "tool", content: m.content ?? "", tool_call_id: id });
      return;
    }
    if (m.role === "assistant" && m.toolCalls?.length) {
      const calls: NonNullable<ProviderWireMessage["tool_calls"]> = m.toolCalls.map((tc) => {
        if (!tc.id || !tc.name) {
          throw new AppError("VALIDATION_FAILED", `Payload tool rusak (pesan ${idx}): tool call tanpa id/nama — request dibatalkan sebelum menghabiskan kuota.`, 422);
        }
        if (declared.has(tc.id)) {
          throw new AppError("VALIDATION_FAILED", `Payload tool rusak: tool_call_id "${tc.id}" dideklarasikan dua kali — request dibatalkan sebelum menghabiskan kuota.`, 422);
        }
        declared.set(tc.id, idx);
        return {
          id: tc.id,
          type: "function" as const,
          function: { name: tc.name, arguments: tc.argumentsJson || "{}" },
          // `extra_content` (mis. thought signature Gemini thinking) hanya
          // diteruskan ke Gemini; provider ketat lain menolak field tak dikenal (400).
          ...(providerKind === "gemini" && tc.extraContent !== undefined ? { extra_content: tc.extraContent } : {}),
        };
      });
      out.push({ role: "assistant", content: m.content ?? "", tool_calls: calls });
      return;
    }
    out.push({ role: m.role as "user" | "assistant", content: m.content ?? "" });
  });

  // Setiap tool_calls wajib dijawab tepat satu tool message, dan sebaliknya.
  for (const [id] of declared) {
    if (!answered.has(id)) {
      throw new AppError("VALIDATION_FAILED", `Payload tool rusak: tool_call_id "${id}" tanpa hasil tool — request dibatalkan sebelum menghabiskan kuota.`, 422);
    }
  }
  for (const [id] of answered) {
    if (!declared.has(id)) {
      throw new AppError("VALIDATION_FAILED", `Payload tool rusak: hasil tool "${id}" tanpa pemanggil — request dibatalkan sebelum menghabiskan kuota.`, 422);
    }
  }
  return out;
}

/** Pastikan definisi tool berupa function-object valid; default schema kosong yang aman. */
export function buildProviderTools(tools: ChatToolDefinition[]): ChatToolDefinition[] {
  return tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.function.name,
      description: t.function.description,
      parameters:
        t.function.parameters && typeof t.function.parameters === "object"
          ? (t.function.parameters as Record<string, unknown>)
          : { type: "object", properties: {} },
    },
  }));
}

/** Ringkasan diagnostik aman (tanpa isi pesan, tanpa kunci) untuk log per-request. */
export function describeProviderRequest(input: {
  messages: ChatMessage[];
  tools: ChatToolDefinition[];
  maxTokens: number;
}): { messageCount: number; toolCount: number; payloadChars: number; estimatedTokens: number } {
  let payloadChars = 0;
  for (const m of input.messages) payloadChars += (m.content ?? "").length + (m.toolCalls?.reduce((n, tc) => n + tc.id.length + tc.name.length + tc.argumentsJson.length, 0) ?? 0);
  try {
    payloadChars += JSON.stringify(input.tools).length;
  } catch {
    payloadChars += 2000;
  }
  const estimatedTokens = estimateRequestTokens({
    messages: input.messages.map((m) => ({ content: m.content })),
    tools: input.tools,
    maxTokens: input.maxTokens,
  });
  return { messageCount: input.messages.length, toolCount: input.tools.length, payloadChars, estimatedTokens };
}

export function createOpenAiCompatibleClient(cfg: ProviderConfigWithKey, logger: Logger, opts: RateLimitedClientOptions = {}): ChatClient {
  // Normalize Gemini baseUrl: strip trailing /v1 if present to avoid path doubling with OpenAI SDK
  let normalizedBaseUrl = cfg.baseUrl.replace(/\/+$/, "");
  if (cfg.kind === "gemini" && normalizedBaseUrl.endsWith("/openai/v1")) {
    normalizedBaseUrl = normalizedBaseUrl.replace(/\/openai\/v1$/, "/openai");
  }

  // Custom fetch to unwrap Google Gemini's array error payloads `[{ "error": ... }]`
  // so the OpenAI SDK can properly read err.error.message instead of throwing "(no body)"
  const customFetch: NonNullable<ConstructorParameters<typeof OpenAI>[0]>["fetch"] = async (url, init) => {
    const res = await fetch(url, init);
    const observe = async (body?: unknown) => {
      try { await cfg.onObservation?.(observeProviderResponse(res.status, res.headers, body)); }
      catch { logger.warn("provider limit observation could not be saved"); }
    };
    if (!res.ok) {
      const text = await res.text();
      let body: unknown;
      try { body = JSON.parse(text); } catch { /* non-JSON upstream */ }
      await observe(body);
      try {
        const parsed = JSON.parse(text);
        if (Array.isArray(parsed) && parsed.length > 0 && parsed[0]?.error) {
          return new Response(JSON.stringify(parsed[0]), {
            status: res.status,
            statusText: res.statusText,
            headers: res.headers,
          });
        }
      } catch {}
      return new Response(text, {
        status: res.status,
        statusText: res.statusText,
        headers: res.headers,
      });
    }
    await observe();
    return res;
  };

  const client = new OpenAI({
    apiKey: cfg.apiKey,
    baseURL: normalizedBaseUrl,
    timeout: 90_000,
    maxRetries: 0, // Surface quota errors promptly; never multiply a user's limited request.
    fetch: customFetch,
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

      let attempt = 0;
      for (;;) {
        // Queue terpusat: tahan sampai kapasitas RPM/TPM tersedia.
        let ticket: Awaited<ReturnType<CentralRateLimiter["acquire"]>>;
        try {
          ticket = await limiter.acquire({
            modelKey,
            providerKind: cfg.kind,
            sharedKey,
            estimatedTokens: estimated,
            signal: input.signal,
          });
        } catch (err) {
          // Antrean penuh / timeout / kuota harian → teruskan sebagai AppError.
          if (err instanceof AppError) throw err;
          const e = err as Error & { code?: string; retryAt?: string };
          if (e?.code === "QUOTA_EXHAUSTED" || e?.code === "RATE_LIMITED" || e?.code === "CANCELLED") {
            throw new AppError(
              e.code === "CANCELLED" ? "UPSTREAM_TIMEOUT" : e.code === "QUOTA_EXHAUSTED" ? "UPSTREAM_QUOTA_EXHAUSTED" : "UPSTREAM_RATE_LIMITED",
              e.message,
              e.code === "CANCELLED" ? 504 : 502,
            );
          }
          throw toProviderError(err, cfg);
        }

        let stream: Awaited<ReturnType<typeof client.chat.completions.create>> | null = null;
        let actualTokens: number | null = null;
        let failed = false;
        try {
          try {
            input.onRequestAttempt?.();
            logger.debug("provider request attempt", {
              provider: cfg.kind,
              model: cfg.model,
              endpoint: endpointHost,
              attempt: attempt + 1,
              ...diag,
            });
            stream = await client.chat.completions.create({
              model: cfg.model,
              messages: wireMessages as never,
              tools: wireTools.length ? wireTools : undefined,
              max_tokens: input.maxTokens,
              stream: true,
              stream_options: { include_usage: true },
            }, { signal: input.signal });
          } catch (err) {
            failed = true;
            const mapped = handleProviderFailure(err, { attempt, maxRetries });
            if (mapped.retry) {
              ticket.abandon();
              attempt += 1;
              await sleepWithAbort(mapped.waitMs, input.signal);
              continue;
            }
            if (mapped.daily) {
              ticket.abandon();
            } else {
              ticket.abandon();
            }
            logger.warn("provider stream request failed", {
              provider: cfg.kind,
              model: cfg.model,
              endpoint: endpointHost,
              attempt: attempt + 1,
              ...diag,
              code: mapped.error.code,
              retryable: false,
              requestId: extractRequestId(err),
              error: redactText(mapped.error.message).slice(0, 300),
            });
            throw mapped.error;
          }

          const toolAcc = new Map<number, { id: string; name: string; args: string; extraContent?: unknown }>();
          let finishReason = "stop";
          const chunks = (async function* () {
            try {
              for await (const chunk of stream!) yield chunk;
            } catch (err) {
              logger.warn("provider stream interrupted", {
                provider: cfg.kind,
                model: cfg.model,
                error: err instanceof Error ? err.message : String(err),
              });
              if (!input.signal?.aborted) {
                const code = Number((err as { status?: number; error?: { code?: number } })?.status ?? (err as { error?: { code?: number } })?.error?.code ?? 500);
                try { await cfg.onObservation?.(observeProviderResponse(code, new Headers(), err)); } catch { /* telemetry is non-fatal */ }
              }
              throw toProviderError(err, cfg);
            }
          })();
          try {
            for await (const chunk of chunks) {
              const choice = chunk.choices?.[0];
              const delta = choice?.delta as
                | { content?: string | null; tool_calls?: { index?: number; id?: string; extra_content?: unknown; function?: { name?: string; arguments?: string } }[] }
                | undefined;
              if (delta?.content) {
                yield { type: "text", text: delta.content };
              }
              for (const tc of delta?.tool_calls ?? []) {
                const idx = tc.index ?? 0;
                const acc = toolAcc.get(idx) ?? { id: "", name: "", args: "", extraContent: undefined };
                if (tc.id) acc.id = tc.id;
                if (tc.function?.name) acc.name = tc.function.name;
                if (tc.function?.arguments) acc.args += tc.function.arguments;
                if (tc.extra_content) acc.extraContent = tc.extra_content;
                toolAcc.set(idx, acc);
              }
              if (chunk.usage && Number.isSafeInteger(chunk.usage.prompt_tokens) && Number.isSafeInteger(chunk.usage.completion_tokens)) {
                actualTokens = (chunk.usage.prompt_tokens ?? 0) + (chunk.usage.completion_tokens ?? 0);
                yield {
                  type: "usage",
                  usage: {
                    promptTokens: chunk.usage.prompt_tokens ?? 0,
                    completionTokens: chunk.usage.completion_tokens ?? 0,
                  },
                };
              }
              if (choice?.finish_reason) {
                if (toolAcc.size > 0) {
                  const calls: ChatToolCall[] = [];
                  for (const [idx, acc] of [...toolAcc.entries()].sort((a, b) => a[0] - b[0])) {
                    if (acc.id && acc.name) {
                      calls.push({ id: acc.id, name: acc.name, argumentsJson: acc.args || "{}", extraContent: acc.extraContent });
                    } else {
                      logger.warn("incomplete tool call delta discarded", { idx });
                    }
                  }
                  if (calls.length) yield { type: "tool_calls", toolCalls: calls };
                }
                finishReason = choice.finish_reason;
                toolAcc.clear();
                // Usage often arrives in a separate final chunk with choices: [].
              }
            }
            // stream ended without finish_reason — treat as done
            if (toolAcc.size > 0) {
              const calls: ChatToolCall[] = [];
              for (const [idx, acc] of [...toolAcc.entries()].sort((a, b) => a[0] - b[0])) {
                if (acc.id && acc.name) calls.push({ id: acc.id, name: acc.name, argumentsJson: acc.args || "{}", extraContent: acc.extraContent });
                else logger.warn("incomplete tool call delta discarded", { idx });
              }
              if (calls.length) yield { type: "tool_calls", toolCalls: calls };
            }
            // Rekonsiliasi TPM: estimasi → token aktual dari respons API.
            ticket.complete(actualTokens ?? estimated);
            limiter.notifySuccess(modelKey);
            yield { type: "done", finishReason };
            return;
          } catch (err) {
            failed = true;
            // Mid-stream 429: hormati Retry-After + backoff terbatas, tanpa retry tak berbatas.
            const status = (err as { status?: number })?.status ?? 0;
            const rawMsg = err instanceof Error ? err.message : String(err);
            const is429 = status === 429 || (err instanceof AppError && /429|Rate limit/i.test(rawMsg));
            if (is429 && attempt < maxRetries && !input.signal?.aborted) {
              const classified = classifyQuotaError(status === 0 ? 429 : status, rawMsg);
              if (!classified.isDaily) {
                const retryMs = extractRetryMs(err) ?? computeBackoffWithJitter(attempt);
                limiter.notifyRateLimited({ modelKey, sharedKey, retryAtMs: Date.now() + retryMs, reason: `429 mid-stream (attempt ${attempt + 1})` });
                ticket.abandon();
                attempt += 1;
                await sleepWithAbort(retryMs, input.signal);
                continue;
              }
            }
            ticket.abandon();
            throw err instanceof AppError ? err : toProviderError(err, cfg);
          } finally {
            if (failed && actualTokens === null) {
              // ticket sudah di-abandon pada tiap jalur gagal; aman dipanggil ulang (idempotent).
            }
          }
        } catch (err) {
          // Retry loop hanya berlanjut via `continue`; selain itu teruskan.
          if (err instanceof AppError) throw err;
          throw toProviderError(err, cfg);
        }
      }

      function handleProviderFailure(
        err: unknown,
        ctx: { attempt: number; maxRetries: number },
      ): { retry: boolean; daily: boolean; waitMs: number; error: AppError } {
        const apiErr = err as { status?: number; headers?: unknown; message?: string; error?: { message?: string; code?: string | number } } | null;
        const status = typeof apiErr?.status === "number" ? apiErr.status : 0;
        const raw = String(apiErr?.error?.message || apiErr?.message || (err instanceof Error ? err.message : String(err)));
        const classified = classifyQuotaError(status === 0 && /resource_exhausted|rate limit|quota/i.test(raw) ? 429 : status, raw);
        const retryMs = extractRetryMs(err) ?? computeBackoffWithJitter(ctx.attempt);

        if (classified.isDaily) {
          const resetAt = extractRetryMs(err) !== null ? Date.now() + (extractRetryMs(err) as number) : nextMidnightUtcMs(Date.now());
          limiter.notifyDailyQuotaExhausted({ modelKey, resetAtMs: resetAt, reason: raw.slice(0, 300) });
          limiter.setFallbackReason(modelKey, `Kuota harian habis pada ${modelKey}; fallback ke model cadangan.`);
          return { retry: false, daily: true, waitMs: 0, error: toProviderError(err, cfg) };
        }
        const isRateLimited = status === 429 || (apiErr?.error?.code as unknown) === 429 || classified.kind === "rate_limit";
        if (isRateLimited) {
          limiter.notifyRateLimited({ modelKey, sharedKey, retryAtMs: Date.now() + retryMs, reason: raw.slice(0, 300) });
          if (ctx.attempt < ctx.maxRetries) {
            limiter.setFallbackReason(modelKey, `Rate limit sementara pada ${modelKey} (retry ${ctx.attempt + 1}/${ctx.maxRetries}).`);
            logger.warn("provider 429 — backoff dengan jitter sebelum retry terbatas", { model: modelKey, waitMs: retryMs, attempt: ctx.attempt });
            return { retry: true, daily: false, waitMs: retryMs, error: toProviderError(err, cfg) };
          }
          return { retry: false, daily: false, waitMs: 0, error: toProviderError(err, cfg) };
        }
        return { retry: false, daily: false, waitMs: 0, error: toProviderError(err, cfg) };
      }

      function extractRequestId(err: unknown): string | null {
        const e = err as {
          headers?: Headers | Record<string, string>;
          requestID?: string;
          error?: { requestID?: string };
        } | null;
        try {
          if (typeof e?.requestID === "string" && e.requestID) return e.requestID.slice(0, 64);
          if (typeof e?.error?.requestID === "string" && e.error.requestID) return e.error.requestID.slice(0, 64);
          const h = e?.headers;
          if (h instanceof Headers) {
            const v = h.get("x-request-id") ?? h.get("request-id");
            return v ? v.slice(0, 64) : null;
          }
          if (h && typeof h === "object") {
            const lower = Object.fromEntries(Object.entries(h).map(([k, v]) => [k.toLowerCase(), String(v)]));
            const v = lower["x-request-id"] ?? lower["request-id"];
            return v ? String(v).slice(0, 64) : null;
          }
        } catch { /* abaikan */ }
        return null;
      }

      function extractRetryMs(err: unknown): number | null {        const e = err as { headers?: Headers | Record<string, string>; status?: number; message?: string; error?: { message?: string } } | null;
        const now = Date.now();
        // Header Retry-After bila SDK menyertakannya
        try {
          const h = e?.headers as Headers | Record<string, string> | undefined;
          let raw: string | null = null;
          if (h instanceof Headers) raw = h.get("retry-after");
          else if (h && typeof h === "object") {
            const lower = Object.fromEntries(Object.entries(h).map(([k, v]) => [k.toLowerCase(), String(v)]));
            raw = lower["retry-after"] ?? null;
          }
          const parsed = parseRetryAfterMs(raw, now);
          if (parsed !== null) return parsed;
        } catch { /* abaikan */ }
        const msg = String((e as { error?: { message?: string } })?.error?.message || (e as { message?: string })?.message || "");
        const m = msg.match(/retry in\s+([\d.]+)\s*s/i) || msg.match(/retryDelay["']?\s*:\s*["']?([\d.]+)s/i) || msg.match(/try again in\s+([\d.]+)\s*s/i);
        if (m) {
          const sec = Number(m[1]);
          if (Number.isFinite(sec)) return Math.min(sec * 1000, 24 * 3600_000);
        }
        return null;
      }

      function sleepWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
        if (ms <= 0) return Promise.resolve();
        if (signal?.aborted) return Promise.reject(new AppError("UPSTREAM_TIMEOUT", "Permintaan dibatalkan.", 504));
        return new Promise((resolve, reject) => {
          const t = setTimeout(() => {
            signal?.removeEventListener("abort", onAbort);
            resolve();
          }, Math.min(ms, 30_000));
          const onAbort = () => {
            clearTimeout(t);
            reject(new AppError("UPSTREAM_TIMEOUT", "Permintaan dibatalkan.", 504));
          };
          signal?.addEventListener("abort", onAbort, { once: true });
        });
      }
    },
  };
}

/** Explicit demo response when no provider has been configured. No tool calls. */
export function createMockClient(): ChatClient {
  return {
    modelLabel: "mock:local",
    async *stream(input) {
      const lastUser = [...input.messages].reverse().find((m) => m.role === "user");
      const text = `[MOCK PROVIDER] Provider AI belum dikonfigurasi. Pertanyaan Anda: "${lastUser?.content ?? ""}". Isi Gemini/OpenRouter/Custom melalui Provider AI untuk jawaban nyata.`;
      for (const word of text.split(" ")) yield { type: "text", text: word + " " };
      yield { type: "done", finishReason: "stop" };
    },
  };
}
