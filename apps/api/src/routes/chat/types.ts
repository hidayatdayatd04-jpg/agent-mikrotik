import { z } from "zod";
import type { Database } from "../../db";
import type { Logger } from "../../lib/logger";
import type { AgentLoop } from "../../agent/loop";
import type { RunEventHub } from "../../agent/hub";
import type { ConnectorService } from "../../services/connector";
import type { ChatClient } from "../../agent/chat-client";
import type { ProviderConfigWithKey } from "../../agent/provider-settings";
import type { TransactionCoordinator } from "../../transactions/coordinator";
import type { buildSystemInstruction } from "../../agent/instructions";
import type { conversations, agentRuns } from "../../db/schema";

export interface ChatRouteDeps {
  db: Database;
  logger: Logger;
  loop: AgentLoop;
  hub: RunEventHub;
  connectors: ConnectorService;
  /** Returns the user's decrypted provider config (or null when unconfigured). */
  getProvider: (userId: string, requestedModel?: string, requestedProviderId?: string) => Promise<ProviderConfigWithKey | null>;
  /** Kandidat fallback lintas provider/model (opsional; bila tak ada, tanpa fallback). */
  getFallbackCandidates?: (userId: string, requestedModel?: string, requestedProviderId?: string) => Promise<{ providerId: string; providerKind: string; model: string; enabled: boolean; baseUrl?: string; name?: string; apiKey?: string }[]>;
  /** Builds a real OpenAI-compatible client from a stored config (terpusat rate-limited; fallback bila disediakan). */
  makeClient: (
    cfg: ProviderConfigWithKey,
    fallbackCandidates?: { providerId: string; providerKind: string; model: string; enabled: boolean; baseUrl?: string; name?: string; apiKey?: string }[],
    runContext?: { runId: string | null; conversationId: string | null; userId: string | null; userText: string | null; policyMode: "read-only" | "write" },
  ) => ChatClient;
  /** Deterministic mock client for unconfigured users. */
  makeMockClient: () => ChatClient;
  /** Executes a dispatched tool on the user's child. */
  executeTool: (input: { userId: string; connectionId: string; fqName: string; args: unknown; retryRead?: boolean }) => Promise<{ ok: boolean; output: string; errorCode?: string }>;
  /** Executes documentation tools via the shared Rosetta process (no router). */
  executeDocsTool: (input: { fqName: string; args: unknown }) => Promise<{ ok: boolean; output: string; errorCode?: string }>;
  /** Executes web search via Tavily (no router). */
  executeWebSearchTool: (input: { userId: string; args: unknown }) => Promise<{ ok: boolean; output: string; errorCode?: string }>;
  /** Builds the system instruction for a run. */
  buildInstruction: typeof buildSystemInstruction;
  /** Loads attachment content for the AI context (ownership pre-checked). */
  loadAttachmentContent: (input: { userId: string; attachmentId: string }) => Promise<{ kind: "image" | "pdf" | "text" | "unsupported"; name: string; mime: string; bytes: Buffer } | null>;
  /** Removes one attachment object from storage (B2). Non-fatal when missing. */
  removeAttachmentObject: (input: { userId: string; objectKey: string }) => Promise<void>;
  limits: { maxSteps: number; maxToolCalls: number; runTimeoutMs: number; maxTokens: number };
  /** Chat run rate limit per user (M10): tokens, ms window. */
  runRateLimit: { maxRuns: number; windowMs: number };
  transactions?: {
    begin: TransactionCoordinator["begin"];
    commit: (txId: string, userId: string) => Promise<{ state: string }>;
    rollback: (txId: string, userId: string, meta: { reason: string }) => Promise<{ state: string }>;
    getActionCount: (txId: string) => number;
  };
}

/** Konteks route yang dibawa antar modul (pengganti closure factory). */
export interface ChatCtx {
  deps: ChatRouteDeps;
  backgroundRuns: Map<string, string>;
  runTimesByUser: Map<string, number[]>;
}

export const CreateSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  connectionId: z.string().uuid().nullable().optional(),
});

export const PatchSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  connectionId: z.string().uuid().nullable().optional(),
  pinned: z.boolean().optional(),
  archived: z.boolean().optional(),
  expectedRevision: z.number().int().min(1).optional(),
});

export const RunSchema = z.object({
  text: z.string().min(1).max(16_000),
  idempotencyKey: z.string().min(8).max(128),
  attachmentIds: z.array(z.string().uuid()).max(4).optional(),
  model: z.string().max(255).optional(),
  providerId: z.string().max(128).optional(),
});

export type RunInput = z.infer<typeof RunSchema>;

export type ConversationRow = typeof conversations.$inferSelect;
export type RunRow = typeof agentRuns.$inferSelect;
