import { estimateRequestTokens } from "../rate-limiter";
import type { ChatMessage, ChatToolDefinition, ProviderRequestDiag } from "./types";

/** Ringkasan diagnostik aman (tanpa isi pesan, tanpa kunci) untuk log per-request. */
export function describeProviderRequest(input: {
  messages: ChatMessage[];
  tools: ChatToolDefinition[];
  maxTokens: number;
}): ProviderRequestDiag {
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
