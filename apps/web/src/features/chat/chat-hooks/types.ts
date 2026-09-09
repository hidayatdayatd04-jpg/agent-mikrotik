import type { ModelLimitStatus } from "@shared/index";

/** Types mirroring backend contracts (routes/chat.ts, routes/attachments.ts). */

export interface ConversationDTO {
  id: string;
  title: string;
  activeConnectionId: string | null;
  createdAt: string;
  updatedAt: string;
  pinnedAt: string | null;
  archivedAt: string | null;
  revision?: number;
}

export interface MessageDTO {
  id: string;
  role: "user" | "assistant";
  content: {
    text?: string;
    runId?: string;
    timeline?: RunEventDTO[];
    attachments?: { id: string; name: string; kind: string }[];
    outcome?: { status: string; code?: string; reason?: string; toolSucceeded?: number; toolFailed?: number; succeededTools?: string[] };
  };
  status: string;
  seq: number;
  createdAt: string;
}

export interface RunEventDTO {
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

export interface AttachmentDTO {
  id: string;
  originalName: string;
  contentType: string;
  sizeBytes: number;
  status: string;
  contentKind?: string;
}

export interface StartRunResult {
  runId: string;
  status: string;
  resumed?: boolean;
}

export interface StartRunInput {
  text: string;
  idempotencyKey: string;
  attachmentIds?: string[];
  model?: string;
  providerId?: string;
}

export interface AiProviderDTO {
  id: string;
  kind: "gemini" | "openrouter" | "custom";
  name: string;
  baseUrl: string;
  models: string[];
  activeModel: string;
  enabled: boolean;
  hasKey: boolean;
  updatedAt?: string;
  modelLimits?: Record<string, ModelLimitStatus>;
}

export interface ProviderSettingsDTO {
  id?: string;
  kind: "gemini" | "openrouter" | "custom";
  name?: string;
  baseUrl: string;
  model: string;
  hasKey?: boolean;
}

export interface RateLimitStatusDTO {
  defaults: { rpm: number; tpm: number };
  activeModel: string | null;
  activeProviderId: string | null;
  globalQueue: number;
  models: {
    modelKey: string;
    providerKind: string;
    rpmUsed: number;
    rpmLimit: number;
    tpmUsed: number;
    tpmLimit: number;
    rpdStatus: { limit: number | null; remaining: number | null; resetAt: string | null } | null;
    queueLength: number;
    nextRetryAt: string | null;
    blockedReason: string | null;
    fallbackReason: string | null;
    isDailyQuotaExhausted: boolean;
  }[];
  checkpoints: { id: string; primaryModelKey: string | null; reason: string; nextRetryAt: string | null; createdAt: string }[];
  note: string;
}

export interface ActivityEventDTO {
  id: string;
  conversationId: string;
  runId: string | null;
  activityId: string;
  parentId: string | null;
  seq: number;
  type: string;
  actor: "user" | "ai" | "system";
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface TerminalCommandDTO {
  id: string;
  command: string;
  status: string;
  exitCode: number | null;
  outputPreview: string;
  truncated: boolean;
  errorCode: string | null;
  transactionId: string | null;
  durationMs: number | null;
  createdAt: string;
  endedAt?: string | null;
}

export interface PreferencesDTO {
  theme: "light" | "dark" | "system";
  sidebarCollapsed: boolean;
  autoCompact: boolean;
  compactThreshold: number;
}
