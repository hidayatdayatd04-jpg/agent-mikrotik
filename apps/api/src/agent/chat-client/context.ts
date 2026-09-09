import type OpenAI from "openai";
import type { Logger } from "../../lib/logger";
import type { CentralRateLimiter } from "../rate-limiter";
import type { ProviderConfigWithKey } from "../provider-settings";
import type {
  ChatToolDefinition,
  ProviderRequestDiag,
  StreamTurnInput,
} from "./types";
import type { ProviderWireMessage } from "./wire";

/** Tiket antrean rate limiter untuk satu upaya request. */
export type TurnTicket = Awaited<ReturnType<CentralRateLimiter["acquire"]>>;

/** Bentuk chunk minimal yang dipakai parser (structural subset SDK). */
export interface SdkChunk {
  choices?: {
    finish_reason?: string | null;
    delta?: {
      content?: string | null;
      tool_calls?: { index?: number; id?: string; extra_content?: unknown; function?: { name?: string; arguments?: string } }[];
    };
  }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

/** State turn yang dibawa antar helper stream (pengganti closure factory). */
export interface TurnCtx {
  cfg: ProviderConfigWithKey;
  logger: Logger;
  limiter: CentralRateLimiter;
  maxRetries: number;
  modelKey: string;
  sharedKey: string | null;
  normalizedBaseUrl: string;
  client: OpenAI;
  input: StreamTurnInput;
  estimated: number;
  diag: ProviderRequestDiag;
  endpointHost: string;
  wireMessages: ProviderWireMessage[];
  wireTools: ChatToolDefinition[];
  /** Temperature sampling (null = tidak dikirim; pakai default model). */
  temperature: number | null;
}
