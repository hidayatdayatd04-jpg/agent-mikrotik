import { AppError } from "../../lib/errors";
import { classifyQuotaError, computeBackoffWithJitter } from "../rate-limiter";
import type { ChatToolCall, StreamEvent } from "./types";
import type { SdkChunk, TurnCtx, TurnTicket } from "./context";
import { toProviderError } from "./errors";
import { extractRetryMs } from "./openai-failure";

export type { SdkChunk, TurnTicket };

export interface DrainResult {
  finishReason: string;
  actualTokens: number | null;
}

export interface DrainRetry {
  retryAfterMs: number;
}

/**
 * Kuras chunk SSE → yield text/tool_calls/usage. Mengembalikan hasil akhir,
 * atau permintaan retry 429 mid-stream (outer yang abandon+sleep+continue).
 */
export async function* drainTurnStream(
  ctx: TurnCtx,
  ticket: TurnTicket,
  chunks: AsyncIterable<SdkChunk>,
  attempt: number,
): AsyncGenerator<StreamEvent, DrainResult | DrainRetry> {
  const { cfg, logger, limiter, modelKey, sharedKey, maxRetries, input } = ctx;
  const toolAcc = new Map<number, { id: string; name: string; args: string; extraContent?: unknown }>();
  let nextToolIdx = 0;
  const idToIdx = new Map<string, number>();
  let lastActiveIdx = 0;

  function resolveToolIndex(tc: { index?: number; id?: string }): number {
    if (typeof tc.index === "number" && Number.isSafeInteger(tc.index) && tc.index >= 0) {
      if (tc.id) idToIdx.set(tc.id, tc.index);
      lastActiveIdx = tc.index;
      if (tc.index >= nextToolIdx) nextToolIdx = tc.index + 1;
      return tc.index;
    }
    if (tc.id) {
      const existing = idToIdx.get(tc.id);
      if (existing !== undefined) {
        lastActiveIdx = existing;
        return existing;
      }
      const idx = nextToolIdx++;
      idToIdx.set(tc.id, idx);
      lastActiveIdx = idx;
      return idx;
    }
    return lastActiveIdx;
  }

  let finishReason = "stop";
  let latestUsage: { promptTokens: number; completionTokens: number } | null = null;
  let actualTokens: number | null = null;
  try {
    for await (const chunk of chunks) {
      const choice = chunk.choices?.[0];
      const delta = choice?.delta;
      if (delta?.content) {
        yield { type: "text", text: delta.content };
      }
      for (const tc of delta?.tool_calls ?? []) {
        const idx = resolveToolIndex(tc);
        const acc = toolAcc.get(idx) ?? { id: "", name: "", args: "", extraContent: undefined };
        if (tc.id) acc.id = tc.id;
        if (tc.function?.name) acc.name = tc.function.name;
        if (tc.function?.arguments) acc.args += tc.function.arguments;
        if (tc.extra_content) acc.extraContent = tc.extra_content;
        toolAcc.set(idx, acc);
      }
      if (chunk.usage && Number.isSafeInteger(chunk.usage.prompt_tokens) && Number.isSafeInteger(chunk.usage.completion_tokens)) {
        actualTokens = (chunk.usage.prompt_tokens ?? 0) + (chunk.usage.completion_tokens ?? 0);
        latestUsage = {
          promptTokens: chunk.usage.prompt_tokens ?? 0,
          completionTokens: chunk.usage.completion_tokens ?? 0,
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
    // Yield latest usage once per stream (avoids compounding token counts when provider yields usage on multiple chunks)
    if (latestUsage) {
      yield {
        type: "usage",
        usage: latestUsage,
      };
    }
    return { finishReason, actualTokens };
  } catch (err) {
    // Mid-stream 429: hormati Retry-After + backoff terbatas, tanpa retry tak berbatas.
    const status = (err as { status?: number })?.status ?? 0;
    const rawMsg = err instanceof Error ? err.message : String(err);
    const is429 = status === 429 || (err instanceof AppError && /429|Rate limit/i.test(rawMsg));
    if (is429 && attempt < maxRetries && !input.signal?.aborted) {
      const classified = classifyQuotaError(status === 0 ? 429 : status, rawMsg);
      if (!classified.isDaily) {
        const retryMs = extractRetryMs(err) ?? computeBackoffWithJitter(attempt);
        limiter.notifyRateLimited({ modelKey, sharedKey, retryAtMs: Date.now() + retryMs, reason: `429 mid-stream (attempt ${attempt + 1})` });
        return { retryAfterMs: retryMs };
      }
    }
    ticket.abandon();
    throw err instanceof AppError ? err : toProviderError(err, cfg);
  }
}
