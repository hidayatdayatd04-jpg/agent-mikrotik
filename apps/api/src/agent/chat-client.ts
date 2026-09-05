import OpenAI from "openai";
import type { Logger } from "../lib/logger";
import type { ProviderConfigWithKey } from "./provider-settings";

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
  }): AsyncGenerator<StreamEvent>;
  modelLabel: string;
}

export function createOpenAiCompatibleClient(cfg: ProviderConfigWithKey, logger: Logger): ChatClient {
  const client = new OpenAI({
    apiKey: cfg.apiKey,
    baseURL: cfg.baseUrl,
    timeout: 90_000,
    maxRetries: 1, // only safe retries of idempotent reads; never mutates
  });
  return {
    modelLabel: `${cfg.kind}:${cfg.model}`,
    async *stream(input) {
      const stream = await client.chat.completions.create({
        model: cfg.model,
        messages: input.messages.map((m) => {
          if (m.role === "tool") {
            return { role: "tool" as const, content: m.content ?? "", tool_call_id: m.toolCallId ?? "" };
          }
          if (m.role === "assistant" && m.toolCalls?.length) {
            return {
              role: "assistant" as const,
              content: m.content ?? null,
              tool_calls: m.toolCalls.map((tc) => ({
                id: tc.id,
                type: "function" as const,
                function: { name: tc.name, arguments: tc.argumentsJson },
              })),
            };
          }
          return { role: m.role as "system" | "user" | "assistant", content: m.content ?? "" };
        }),
        tools: input.tools.length ? input.tools : undefined,
        max_tokens: input.maxTokens,
        stream: true,
        stream_options: { include_usage: true },
      });
      const toolAcc = new Map<number, { id: string; name: string; args: string }>();
      for await (const chunk of stream) {
        const choice = chunk.choices?.[0];
        const delta = choice?.delta as
          | { content?: string | null; tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string } }[] }
          | undefined;
        if (delta?.content) {
          yield { type: "text", text: delta.content };
        }
        for (const tc of delta?.tool_calls ?? []) {
          const idx = tc.index ?? 0;
          const acc = toolAcc.get(idx) ?? { id: "", name: "", args: "" };
          if (tc.id) acc.id = tc.id;
          if (tc.function?.name) acc.name = tc.function.name;
          if (tc.function?.arguments) acc.args += tc.function.arguments;
          toolAcc.set(idx, acc);
        }
        if (chunk.usage) {
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
                calls.push({ id: acc.id, name: acc.name, argumentsJson: acc.args || "{}" });
              } else {
                logger.warn("incomplete tool call delta discarded", { idx });
              }
            }
            if (calls.length) yield { type: "tool_calls", toolCalls: calls };
          }
          yield { type: "done", finishReason: choice.finish_reason };
          return;
        }
      }
      // stream ended without finish_reason — treat as done
      if (toolAcc.size > 0) {
        const calls: ChatToolCall[] = [];
        for (const [idx, acc] of [...toolAcc.entries()].sort((a, b) => a[0] - b[0])) {
          if (acc.id && acc.name) calls.push({ id: acc.id, name: acc.name, argumentsJson: acc.args || "{}" });
          else logger.warn("incomplete tool call delta discarded", { idx });
        }
        if (calls.length) yield { type: "tool_calls", toolCalls: calls };
      }
      yield { type: "done", finishReason: "stop" };
    },
  };
}

/**
 * Deterministic mock for dev/test: answers documentation-style questions and
 * emits one well-formed tool call when the user asks to check the router.
 * Never used when a real provider is configured.
 */
export function createMockClient(): ChatClient {
  return {
    modelLabel: "mock:dev",
    async *stream(input) {
      const lastUser = [...input.messages].reverse().find((m) => m.role === "user");
      const q = (lastUser?.content ?? "").toLowerCase();
      // Only call tools when a real router tool catalog was provided
      const wantsRouter = /(router|interface|dhcp|firewall|ip address|konek|perangkat)/.test(q);
      if (input.tools.length > 0 && wantsRouter) {
        const tool = input.tools[0]!;
        yield { type: "tool_calls", toolCalls: [{ id: "mock-call-1", name: tool.function.name, argumentsJson: "{}" }] };
        yield { type: "done", finishReason: "tool_calls" };
        return;
      }
      const text =
        q.includes("safe mode")
          ? "Safe Mode RouterOS menahan perubahan sampai commit. Jika koneksi putus sebelum commit, RouterOS otomatis membatalkan perubahan tersebut. Saya hanya memulai transaksi lewat mekanisme backend — bukan perintah langsung."
          : `[MOCK PROVIDER] Saya agent dev tanpa kredensial AI nyata. Anda bertanya: "${lastUser?.content ?? ""}". Konfigurasikan provider (Gemini/OpenRouter/Custom) dari pengaturan untuk jawaban nyata.`;
      // stream in small chunks to exercise SSE handling
      for (const word of text.split(" ")) {
        yield { type: "text", text: word + " " };
      }
      yield { type: "usage", usage: { promptTokens: 40, completionTokens: 30 } };
      yield { type: "done", finishReason: "stop" };
    },
  };
}
