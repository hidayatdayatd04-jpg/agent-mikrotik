import { sqliteTable, text, integer, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import { routerConnections, workspaces } from "./schema-core";

export const conversations = sqliteTable(
  "conversations",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    title: text("title").notNull().default("Percakapan baru"),
    activeConnectionId: text("active_connection_id").references(() => routerConnections.id, {
      onDelete: "set null",
    }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
    deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
    pinnedAt: integer("pinned_at", { mode: "timestamp_ms" }),
    archivedAt: integer("archived_at", { mode: "timestamp_ms" }),
    revision: integer("revision").notNull().default(1),
  },
  (t) => [
    index("conversations_user_idx").on(t.userId, t.updatedAt),
    index("conversations_user_archived_idx").on(t.userId, t.archivedAt),
  ],
);

export const messages = sqliteTable(
  "messages",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    content: text("content", { mode: "json" }).notNull(),
    status: text("status").notNull().default("complete"),
    seq: integer("seq").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  },
  (t) => [
    index("messages_conversation_seq_idx").on(t.conversationId, t.seq),
  ],
);

export const attachments = sqliteTable(
  "attachments",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    conversationId: text("conversation_id").references(() => conversations.id, {
      onDelete: "cascade",
    }),
    messageId: text("message_id").references(() => messages.id, { onDelete: "set null" }),
    objectKey: text("object_key").notNull().unique(),
    originalName: text("original_name").notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    checksum: text("checksum"),
    status: text("status").notNull().default("uploading"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  },
  (t) => [index("attachments_user_idx").on(t.userId, t.createdAt)],
);

export const agentRuns = sqliteTable(
  "agent_runs",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    connectionId: text("connection_id").references(() => routerConnections.id, {
      onDelete: "set null",
    }),
    idempotencyKey: text("idempotency_key"),
    status: text("status").notNull().default("queued"),
    model: text("model"),
    usage: text("usage", { mode: "json" }),
    startedAt: integer("started_at", { mode: "timestamp_ms" }),
    endedAt: integer("ended_at", { mode: "timestamp_ms" }),
    cancelRequested: integer("cancel_requested", { mode: "boolean" }).notNull().default(false),
    policyVersion: integer("policy_version").notNull().default(1),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  },
  (t) => [
    uniqueIndex("agent_runs_idempotency_idx").on(t.conversationId, t.idempotencyKey),
    index("agent_runs_conversation_idx").on(t.conversationId, t.status),
  ],
);

export const toolExecutions = sqliteTable(
  "tool_executions",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    runId: text("run_id")
      .notNull()
      .references(() => agentRuns.id, { onDelete: "cascade" }),
    toolCallId: text("tool_call_id").notNull(),
    toolName: text("tool_name").notNull(),
    risk: text("risk").notNull(),
    sanitizedInput: text("sanitized_input", { mode: "json" }),
    resultSummary: text("result_summary"),
    status: text("status").notNull(),
    durationMs: integer("duration_ms"),
    errorCode: text("error_code"),
    startedAt: integer("started_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  },
  (t) => [uniqueIndex("tool_executions_call_idx").on(t.runId, t.toolCallId)],
);
