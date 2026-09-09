import type { Database } from "../../db";
import type { Logger } from "../../lib/logger";
import type { ChatClient } from "../chat-client";
import type { PolicyDispatcher, PolicySnapshot } from "../../policies/dispatcher";
import type { TransactionCoordinator } from "../../transactions/coordinator";
import type { NormalizedTool } from "../../policies/normalize";
import type { ReasoningEffort } from "@shared/index";

export interface RunEvent {
  type:
    | "run.started"
    | "message.delta"
    | "tool.started"
    | "tool.completed"
    | "tool.failed"
    | "transaction.updated"
    | "provider.waiting"
    | "run.completed"
    | "run.failed"
    | "run.cancelled";
  seq: number;
  runId: string;
  payload: Record<string, unknown>;
}

export interface AgentRunDeps {
  db: Database;
  logger: Logger;
  dispatcher: PolicyDispatcher;
  txCoordinator: TransactionCoordinator;
  catalog: { getCatalog(mode: "read-only" | "write"): Promise<NormalizedTool[]> };
  limits: { maxSteps: number; maxToolCalls: number; runTimeoutMs: number; maxTokens: number };
}

export interface StartRunInput {
  runId: string;
  userId: string;
  conversationId: string;
  connectionId: string | null;
  userMessageId: string;
  userText: string;
  policy: PolicySnapshot;
  /** Per-run provider client (user-configured provider or mock). */
  client: ChatClient;
  /** Executes a dispatched tool on the user's MCP child; backend-owned. */
  executeTool: (input: { fqName: string; args: unknown; retryRead?: boolean }) => Promise<{ ok: boolean; output: string; errorCode?: string }>;
  /** System instruction with mode/router/doc rules for this run. */
  systemInstruction: string;
  /**
   * Upaya penalaran pilihan pengguna untuk run ini (diteruskan ke provider
   * sebagai `reasoning_effort`; undefined = default model).
   */
  reasoningEffort?: ReasoningEffort;
  /** Lazily opens Safe Mode transaction only when a mutation is about to run */
  ensureTransaction?: () => Promise<{ ok: boolean; transactionId?: string; error?: string }>;
}

export const MAX_TOOL_RESULT_CHARS = 8_000;
