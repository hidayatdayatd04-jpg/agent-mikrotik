import type { CentralRateLimiter } from "../rate-limiter";

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

/** Input satu turn assistant (dipakai ChatClient.stream dan konteks internal). */
export interface StreamTurnInput {
  messages: ChatMessage[];
  tools: ChatToolDefinition[];
  maxTokens: number;
  signal?: AbortSignal;
  /** Dipanggil setiap upaya HTTP ke provider (termasuk retry). Untuk pencatatan jumlah request AI. */
  onRequestAttempt?: () => void;
  /** Dipanggil setelah keluar antrean rate limiter dengan lama tunggu (ms). */
  onQueueWait?: (waitedMs: number) => void;
}

export interface ChatClient {
  /** Streams one assistant turn; yields text deltas then tool_calls. */
  stream(input: StreamTurnInput): AsyncGenerator<StreamEvent>;
  modelLabel: string;
}

export interface RateLimitedClientOptions {
  limiter?: CentralRateLimiter;
  /** Batas retry untuk 429 rate-limit biasa (bukan kuota harian). Default dari limiter. */
  maxRetries?: number;
  /**
   * Sampling temperature untuk presisi tool-calling (null = jangan kirim
   * parameter; model memakai default-nya). Nilai rendah (≈0.15) membuat
   * pemilihan tool & argumen konsisten antar turn.
   */
  temperature?: number | null;
}

/** Ringkasan diagnostik aman (tanpa isi pesan, tanpa kunci) untuk log per-request. */
export interface ProviderRequestDiag {
  messageCount: number;
  toolCount: number;
  payloadChars: number;
  estimatedTokens: number;
}
