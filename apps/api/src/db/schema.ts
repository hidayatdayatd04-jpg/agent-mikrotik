import { sqliteTable, text, integer, index, uniqueIndex, primaryKey } from "drizzle-orm/sqlite-core";

export const workspaces = sqliteTable("workspaces", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull().default("Lokal"),
});

export const routerConnections = sqliteTable(
  "router_connections",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    host: text("host").notNull(),
    port: integer("port").notNull().default(22),
    username: text("username").notNull(),
    passwordCiphertext: text("password_ciphertext"),
    passwordNonce: text("password_nonce"),
    passwordAuthTag: text("password_auth_tag"),
    keyVersion: integer("key_version").notNull().default(1),
    hostKeyFingerprint: text("host_key_fingerprint"),
    routerIdentity: text("router_identity"),
    status: text("status").notNull().default("unverified"),
    lastVerifiedAt: integer("last_verified_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  },
  (t) => [index("router_connections_user_idx").on(t.userId)],
);

export const connectionPermissions = sqliteTable(
  "connection_permissions",
  {
    userId: text("user_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    connectionId: text("connection_id")
      .notNull()
      .references(() => routerConnections.id, { onDelete: "cascade" }),
    writeEnabled: integer("write_enabled", { mode: "boolean" }).notNull().default(false),
    version: integer("version").notNull().default(1),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.connectionId] }),
    index("connection_permissions_conn_idx").on(t.connectionId),
  ],
);

export const aiProviderSettings = sqliteTable(
  "ai_provider_settings",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(), // gemini | openrouter | custom
    baseUrl: text("base_url").notNull(),
    model: text("model").notNull(),
    // apiKey sealed with the same AES-256-GCM keyRing as router credentials
    apiKeyCiphertext: text("api_key_ciphertext").notNull(),
    apiKeyNonce: text("api_key_nonce").notNull(),
    apiKeyAuthTag: text("api_key_auth_tag").notNull(),
    keyVersion: integer("key_version").notNull().default(1),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  },
);

export const aiProviders = sqliteTable(
  "ai_providers",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(), // gemini | openrouter | custom
    name: text("name").notNull(),
    baseUrl: text("base_url").notNull(),
    apiKeyCiphertext: text("api_key_ciphertext").notNull(),
    apiKeyNonce: text("api_key_nonce").notNull(),
    apiKeyAuthTag: text("api_key_auth_tag").notNull(),
    keyVersion: integer("key_version").notNull().default(1),
    models: text("models", { mode: "json" }).notNull().$defaultFn(() => []),
    modelLimits: text("model_limits", { mode: "json" }).$type<Record<string, import("@shared/index").ModelLimitStatus>>(),
    activeModel: text("active_model").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  },
  (t) => [index("ai_providers_user_idx").on(t.userId)],
);

export const accounts = sqliteTable(
  "accounts",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    username: text("username").notNull().unique(),
    loginAlias: text("login_alias").unique(),
    displayName: text("display_name").notNull(),
    passwordHash: text("password_hash").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  },
  (t) => [index("accounts_workspace_idx").on(t.workspaceId)],
);

export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    tokenHash: text("token_hash").notNull().unique(),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    revokedAt: integer("revoked_at", { mode: "timestamp_ms" }),
    lastSeenAt: integer("last_seen_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  },
  (t) => [index("sessions_account_idx").on(t.accountId, t.expiresAt)],
);

export const preferences = sqliteTable(
  "preferences",
  {
    accountId: text("account_id")
      .primaryKey()
      .references(() => accounts.id, { onDelete: "cascade" }),
    theme: text("theme").notNull().default("system"),
    sidebarCollapsed: integer("sidebar_collapsed", { mode: "boolean" }).notNull().default(false),
    autoCompact: integer("auto_compact", { mode: "boolean" }).notNull().default(true),
    compactThreshold: integer("compact_threshold").notNull().default(80),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  },
);

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

export const changeTransactions = sqliteTable(
  "change_transactions",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    connectionId: text("connection_id")
      .notNull()
      .references(() => routerConnections.id, { onDelete: "cascade" }),
    routerIdentity: text("router_identity"),
    runId: text("run_id").references(() => agentRuns.id, { onDelete: "set null" }),
    state: text("state").notNull().default("preparing"),
    lockOwner: text("lock_owner"),
    verification: text("verification", { mode: "json" }),
    outcome: text("outcome"),
    recoveryMetadata: text("recovery_metadata", { mode: "json" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  },
  (t) => [index("change_transactions_conn_idx").on(t.connectionId, t.state)],
);

export const auditEvents = sqliteTable(
  "audit_events",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id").references(() => workspaces.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    connectionId: text("connection_id"),
    runId: text("run_id"),
    metadata: text("metadata", { mode: "json" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  },
  (t) => [
    index("audit_events_user_time_idx").on(t.userId, t.createdAt),
    index("audit_events_connection_time_idx").on(t.connectionId, t.createdAt),
  ],
);

export const conversationSummaries = sqliteTable(
  "conversation_summaries",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    throughSeq: integer("through_seq").notNull(),
    sourceRevision: integer("source_revision").notNull().default(1),
    sourceHash: text("source_hash"),
    summary: text("summary").notNull(),
    model: text("model"),
    provider: text("provider"),
    usage: text("usage", { mode: "json" }),
    tokenBefore: integer("token_before"),
    tokenAfter: integer("token_after"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  },
  (t) => [
    uniqueIndex("conversation_summaries_version_idx").on(t.conversationId, t.version),
    index("conversation_summaries_conv_idx").on(t.conversationId, t.throughSeq),
  ],
);

export const compactionJobs = sqliteTable(
  "compaction_jobs",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    sourceRevision: integer("source_revision").notNull().default(1),
    status: text("status").notNull().default("queued"),
    reason: text("reason").notNull().default("manual"),
    summaryVersion: integer("summary_version"),
    error: text("error"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  },
  (t) => [index("compaction_jobs_conv_idx").on(t.conversationId, t.status)],
);

export const activityEvents = sqliteTable(
  "activity_events",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    runId: text("run_id").references(() => agentRuns.id, { onDelete: "cascade" }),
    activityId: text("activity_id").notNull(),
    parentId: text("parent_id"),
    seq: integer("seq").notNull(),
    type: text("type").notNull(),
    actor: text("actor").notNull().default("system"),
    payload: text("payload", { mode: "json" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  },
  (t) => [
    index("activity_events_conv_seq_idx").on(t.conversationId, t.seq),
    index("activity_events_run_seq_idx").on(t.runId, t.seq),
    index("activity_events_conv_type_idx").on(t.conversationId, t.type),
  ],
);

export const terminalSessions = sqliteTable(
  "terminal_sessions",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    connectionId: text("connection_id")
      .notNull()
      .references(() => routerConnections.id, { onDelete: "cascade" }),
    conversationId: text("conversation_id").references(() => conversations.id, { onDelete: "set null" }),
    actor: text("actor").notNull().default("user"),
    status: text("status").notNull().default("open"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
    closedAt: integer("closed_at", { mode: "timestamp_ms" }),
  },
  (t) => [
    index("terminal_sessions_user_idx").on(t.userId, t.status),
    index("terminal_sessions_conn_idx").on(t.connectionId, t.status),
  ],
);

export const terminalCommands = sqliteTable(
  "terminal_commands",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    sessionId: text("session_id")
      .notNull()
      .references(() => terminalSessions.id, { onDelete: "cascade" }),
    command: text("command").notNull(),
    status: text("status").notNull().default("queued"),
    transactionId: text("transaction_id").references(() => changeTransactions.id, { onDelete: "set null" }),
    exitCode: integer("exit_code"),
    durationMs: integer("duration_ms"),
    outputPreview: text("output_preview").notNull().default(""),
    truncated: integer("truncated", { mode: "boolean" }).notNull().default(false),
    errorCode: text("error_code"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
    endedAt: integer("ended_at", { mode: "timestamp_ms" }),
  },
  (t) => [index("terminal_commands_session_idx").on(t.sessionId, t.createdAt)],
);
