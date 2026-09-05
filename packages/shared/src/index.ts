import { z } from "zod";

export const API_ERROR_CODES = [
  "AUTH_REQUIRED",
  "OTP_INVALID",
  "OTP_EXPIRED",
  "OTP_CONSUMED",
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

export const SessionUserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  name: z.string().min(1),
  avatarUrl: z.string().url().nullable(),
  emailVerified: z.boolean(),
});

export type SessionUser = z.infer<typeof SessionUserSchema>;

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
});

export type ConversationDTO = z.infer<typeof ConversationDTOSchema>;

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
