import { z } from "zod";

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
