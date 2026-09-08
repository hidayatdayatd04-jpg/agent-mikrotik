import { z } from "zod";

export const API_ERROR_CODES = [
  "UNAUTHORIZED",
  "RATE_LIMITED",
  "VALIDATION_FAILED",
  "NOT_FOUND",
  "FORBIDDEN",
  "SSH_AUTH_FAILED",
  "SSH_TIMEOUT",
  "SSH_UNREACHABLE",
  "HOST_KEY_CHANGED",
  "HOST_NOT_ALLOWED",
  "WRITE_DISABLED",
  "POLICY_CHANGED",
  "SAFE_MODE_UNAVAILABLE",
  "TOOL_UNSUPPORTED",
  "TRANSACTION_UNKNOWN",
  "RUN_ALREADY_ACTIVE",
  "PROVIDER_NOT_CONFIGURED",
  "UPSTREAM_AUTH_FAILED",
  "UPSTREAM_TIMEOUT",
  "UPSTREAM_ERROR",
  "UPSTREAM_INVALID_REQUEST",
  "UPSTREAM_RATE_LIMITED",
  "UPSTREAM_QUOTA_EXHAUSTED",
  "FILE_TOO_LARGE",
  "STORAGE_UNAVAILABLE",
  "CONFLICT",
  "UPLOAD_TOO_LARGE",
  "UNSUPPORTED_MEDIA_TYPE",
  "INTERNAL_ERROR",
] as const;

export const ApiErrorCodes = API_ERROR_CODES;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

export const ApiErrorSchema = z.object({
  code: z.enum(API_ERROR_CODES),
  message: z.string(),
  requestId: z.string(),
  fieldErrors: z.record(z.string(), z.string()).optional(),
});

export type ApiError = z.infer<typeof ApiErrorSchema>;


export const RouterModeSchema = z.enum(["read-only", "write"]);
export type RouterMode = z.infer<typeof RouterModeSchema>;

export const ConnectorStatusSchema = z.enum([
  "unverified",
  "connecting",
  "connected",
  "disconnected",
  "failed",
]);

export type ConnectorStatus = z.infer<typeof ConnectorStatusSchema>;

export const ConnectorDTOSchema = z.object({
  id: z.string().uuid(),
  label: z.string(),
  host: z.string(),
  port: z.number().int().min(1).max(65535),
  username: z.string(),
  status: ConnectorStatusSchema,
  mode: RouterModeSchema,
  modeVersion: z.number().int(),
  hostKeyFingerprint: z.string().nullable(),
  lastVerifiedAt: z.string().datetime().nullable(),
  routerIdentity: z.string().nullable(),
  rosVersion: z.string().nullable().optional(),
  boardName: z.string().nullable().optional(),
  architecture: z.string().nullable().optional(),
  managementInterface: z.string().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type ConnectorDTO = z.infer<typeof ConnectorDTOSchema>;

export const ConversationDTOSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  activeConnectionId: z.string().uuid().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  pinnedAt: z.string().datetime().nullable().optional(),
  archivedAt: z.string().datetime().nullable().optional(),
  revision: z.number().int().optional(),
});

export type ConversationDTO = z.infer<typeof ConversationDTOSchema>;

export const AccountProfileSchema = z.object({
  id: z.string().uuid(),
  username: z.string(),
  displayName: z.string(),
  loginAlias: z.string().nullable().optional(),
  createdAt: z.string().datetime().optional(),
});

export type AccountProfile = z.infer<typeof AccountProfileSchema>;

export const ActivityEventSchema = z.object({
  id: z.string().uuid(),
  conversationId: z.string().uuid(),
  runId: z.string().uuid().nullable(),
  activityId: z.string(),
  parentId: z.string().nullable(),
  seq: z.number().int(),
  type: z.string(),
  actor: z.enum(["user", "ai", "system"]),
  payload: z.record(z.string(), z.unknown()),
  createdAt: z.string().datetime(),
});

export type ActivityEventDTO = z.infer<typeof ActivityEventSchema>;

export const CompactionJobSchema = z.object({
  id: z.string().uuid(),
  conversationId: z.string().uuid(),
  status: z.enum(["queued", "running", "completed", "failed", "cancelled"]),
  reason: z.string(),
  summaryVersion: z.number().int().nullable(),
  error: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type CompactionJobDTO = z.infer<typeof CompactionJobSchema>;

export const TerminalCommandSchema = z.object({
  id: z.string().uuid(),
  sessionId: z.string().uuid(),
  command: z.string(),
  status: z.enum(["queued", "running", "completed", "failed", "cancelled", "rejected"]),
  exitCode: z.number().int().nullable(),
  transactionId: z.string().uuid().nullable(),
  durationMs: z.number().int().nullable(),
  outputPreview: z.string(),
  truncated: z.boolean(),
  createdAt: z.string().datetime(),
});

export type TerminalCommandDTO = z.infer<typeof TerminalCommandSchema>;

export const MessageRoleSchema = z.enum(["user", "assistant"]);
export type MessageRole = z.infer<typeof MessageRoleSchema>;

export const RunStatusSchema = z.enum([
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
]);

export type RunStatus = z.infer<typeof RunStatusSchema>;

/** Structured Deep Research payload for the chat canvas (web: tool results). */
export interface ResearchSource {
  title: string;
  url: string;
  snippet: string;
}

export interface ResearchResult {
  query: string;
  answer: string | null;
  sources: ResearchSource[];
}

export const RunEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("run.started"), seq: z.number().int() }),
  z.object({ type: z.literal("message.delta"), seq: z.number().int(), text: z.string() }),
  z.object({ type: z.literal("tool.started"), seq: z.number().int(), tool: z.string() }),
  z.object({
    type: z.literal("tool.completed"),
    seq: z.number().int(),
    tool: z.string(),
    summary: z.string(),
  }),
  z.object({
    type: z.literal("tool.failed"),
    seq: z.number().int(),
    tool: z.string(),
    summary: z.string(),
  }),
  z.object({
    type: z.literal("transaction.updated"),
    seq: z.number().int(),
    state: z.string(),
    detail: z.string(),
  }),
  z.object({ type: z.literal("run.completed"), seq: z.number().int() }),
  z.object({ type: z.literal("run.failed"), seq: z.number().int(), summary: z.string() }),
  z.object({ type: z.literal("run.cancelled"), seq: z.number().int() }),
  z.object({ type: z.literal("heartbeat"), seq: z.number().int() }),
]);

export type RunEvent = z.infer<typeof RunEventSchema>;

export const AttachmentDTOSchema = z.object({
  id: z.string().uuid(),
  fileName: z.string(),
  sizeBytes: z.number().int(),
  contentType: z.string(),
  status: z.enum(["uploading", "ready", "failed"]),
  createdAt: z.string().datetime(),
});

export type AttachmentDTO = z.infer<typeof AttachmentDTOSchema>;
export interface ModelLimitStatus {
  status: "available" | "limited" | "error";
  observedAt: string;
  retryAt: string | null;
  requestsLimit: number | null;
  requestsRemaining: number | null;
  tokensLimit: number | null;
  tokensRemaining: number | null;
  /** Status RPD harian — hanya bila provider menyediakannya; null bila tak ada. */
  dailyLimit?: number | null;
  dailyRemaining?: number | null;
  dailyResetAt?: string | null;
  /** True bila observasi terakhir mengindikasikan kuota harian habis. */
  isDailyQuotaExhausted?: boolean;
}

// ── Monitoring Types ──────────────────────────────────────────

export interface InterfaceInfo {
  name: string;
  type: string;
  status: string; // up | down | disabled
  rxBytes: number;
  txBytes: number;
  rxRate: string | null;
  txRate: string | null;
  macAddress: string | null;
}

export interface MonitoringLiveData {
  identity: string | null;
  model: string | null;
  rosVersion: string | null;
  architecture: string | null;
  uptime: string | null;
  cpuLoad: number | null;
  cpuCount: number | null;
  freeMemory: number | null;
  totalMemory: number | null;
  memoryPercent: number | null;
  temperature: number | null;
  routerOnline: boolean;
  internetOnline: boolean | null;
  interfaces: InterfaceInfo[];
  connectedClients: number | null;
  collectedAt: string;
}

export interface MonitoringSnapshotItem {
  data: Record<string, unknown>;
  collectedAt: string;
}

// ── Notification Types ────────────────────────────────────────

export const NotificationTypeSchema = z.enum(["info", "success", "warning", "critical"]);
export type NotificationType = z.infer<typeof NotificationTypeSchema>;

export const NotificationCategorySchema = z.enum([
  "router_status",
  "resource",
  "interface",
  "backup",
  "config",
  "agent",
]);
export type NotificationCategory = z.infer<typeof NotificationCategorySchema>;

export const NotificationDTOSchema = z.object({
  id: z.string().uuid(),
  type: NotificationTypeSchema,
  category: NotificationCategorySchema,
  title: z.string(),
  message: z.string(),
  read: z.boolean(),
  routerLabel: z.string().nullable(),
  connectionId: z.string().nullable(),
  createdAt: z.string().datetime(),
  readAt: z.string().datetime().nullable(),
});
export type NotificationDTO = z.infer<typeof NotificationDTOSchema>;

export const NotificationSettingsDTOSchema = z.object({
  cpuThreshold: z.number().int().min(1).max(100),
  ramThreshold: z.number().int().min(1).max(100),
  cooldownMs: z.number().int().min(1000),
  enabledCategories: z.array(NotificationCategorySchema),
});
export type NotificationSettingsDTO = z.infer<typeof NotificationSettingsDTOSchema>;

// ── Backup Types ──────────────────────────────────────────────

export const ConfigBackupDTOSchema = z.object({
  id: z.string().uuid(),
  connectionId: z.string().uuid(),
  name: z.string(),
  type: z.enum(["export_text", "binary_backup"]),
  routerIdentity: z.string().nullable(),
  rosVersion: z.string().nullable(),
  boardName: z.string().nullable(),
  sizeBytes: z.number().int(),
  status: z.enum(["completed", "failed", "in_progress"]),
  createdBy: z.enum(["user", "system", "agent"]),
  errorMessage: z.string().nullable(),
  createdAt: z.string().datetime(),
});
export type ConfigBackupDTO = z.infer<typeof ConfigBackupDTOSchema>;

export interface DiffLine {
  type: "added" | "removed" | "unchanged";
  lineNumber: { left: number | null; right: number | null };
  content: string;
}

export interface DiffResult {
  added: number;
  removed: number;
  changed: number;
  lines: DiffLine[];
}

// ── Approval Types ────────────────────────────────────────────

export const ApprovalStatusSchema = z.enum([
  "pending",
  "approved",
  "rejected",
  "expired",
  "executed",
  "failed",
]);
export type ApprovalStatus = z.infer<typeof ApprovalStatusSchema>;

export const RiskLevelSchema = z.enum(["low", "medium", "high", "critical"]);
export type RiskLevel = z.infer<typeof RiskLevelSchema>;

export interface ApprovalOperation {
  command: string;
  description: string;
  risk: "read" | "write" | "destructive";
}

export const ApprovalDTOSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  connectionId: z.string().uuid(),
  runId: z.string().uuid().nullable(),
  conversationId: z.string().uuid().nullable(),
  status: ApprovalStatusSchema,
  summary: z.string(),
  operations: z.array(
    z.object({
      command: z.string(),
      description: z.string(),
      risk: z.enum(["read", "write", "destructive"]),
    }),
  ),
  riskLevel: RiskLevelSchema,
  impactDescription: z.string().nullable(),
  affectedObjects: z.array(z.string()).nullable(),
  operationsHash: z.string(),
  expiresAt: z.string().datetime(),
  approvedAt: z.string().datetime().nullable(),
  rejectedAt: z.string().datetime().nullable(),
  rejectedReason: z.string().nullable(),
  executedAt: z.string().datetime().nullable(),
  executionResult: z.record(z.string(), z.unknown()).nullable(),
  executionError: z.string().nullable(),
  preBackupId: z.string().nullable(),
  createdAt: z.string().datetime(),
});
export type ApprovalDTO = z.infer<typeof ApprovalDTOSchema>;

export interface OperationLogDTO {
  id: string;
  seq: number;
  command: string;
  status: string;
  output: string | null;
  errorMessage: string | null;
  durationMs: number | null;
  executedAt: string | null;
}
