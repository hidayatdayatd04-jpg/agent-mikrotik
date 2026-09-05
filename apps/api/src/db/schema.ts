import {
  pgTable,
  uuid,
  text,
  varchar,
  timestamp,
  boolean,
  integer,
  bigint,
  jsonb,
  index,
  uniqueIndex,
  primaryKey,
} from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: varchar("email", { length: 320 }).notNull().unique(),
  name: varchar("name", { length: 200 }).notNull(),
  avatarUrl: text("avatar_url"),
  emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const authIdentities = pgTable(
  "auth_identities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: varchar("provider", { length: 32 }).notNull(),
    subject: varchar("subject", { length: 255 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("auth_identities_provider_subject_idx").on(t.provider, t.subject)],
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: varchar("token_hash", { length: 128 }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("sessions_token_hash_idx").on(t.tokenHash),
    index("sessions_user_idx").on(t.userId),
    index("sessions_expiry_idx").on(t.expiresAt),
  ],
);

export const otpChallenges = pgTable(
  "otp_challenges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: varchar("email", { length: 320 }).notNull(),
    purpose: varchar("purpose", { length: 32 }).notNull().default("login"),
    digest: varchar("digest", { length: 128 }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    attempts: integer("attempts").notNull().default(0),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    deliveryStatus: varchar("delivery_status", { length: 32 }).notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("otp_challenges_email_idx").on(t.email, t.createdAt)],
);

export const rateLimitBuckets = pgTable(
  "rate_limit_buckets",
  {
    keyHash: varchar("key_hash", { length: 128 }).notNull(),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    count: integer("count").notNull().default(0),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.keyHash, t.windowStart] })],
);

export const routerConnections = pgTable(
  "router_connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    label: varchar("label", { length: 200 }).notNull(),
    host: varchar("host", { length: 255 }).notNull(),
    port: integer("port").notNull().default(22),
    username: varchar("username", { length: 128 }).notNull(),
    passwordCiphertext: text("password_ciphertext"),
    passwordNonce: varchar("password_nonce", { length: 64 }),
    passwordAuthTag: varchar("password_auth_tag", { length: 64 }),
    keyVersion: integer("key_version").notNull().default(1),
    hostKeyFingerprint: varchar("host_key_fingerprint", { length: 128 }),
    routerIdentity: varchar("router_identity", { length: 255 }),
    status: varchar("status", { length: 32 }).notNull().default("unverified"),
    lastVerifiedAt: timestamp("last_verified_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("router_connections_user_idx").on(t.userId)],
);

export const connectionPermissions = pgTable(
  "connection_permissions",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => routerConnections.id, { onDelete: "cascade" }),
    writeEnabled: boolean("write_enabled").notNull().default(false),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.connectionId] }),
    index("connection_permissions_conn_idx").on(t.connectionId),
  ],
);

export const aiProviderSettings = pgTable(
  "ai_provider_settings",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: varchar("kind", { length: 32 }).notNull(), // gemini | openrouter | custom
    baseUrl: varchar("base_url", { length: 512 }).notNull(),
    model: varchar("model", { length: 255 }).notNull(),
    // apiKey sealed with the same AES-256-GCM keyRing as router credentials
    apiKeyCiphertext: text("api_key_ciphertext").notNull(),
    apiKeyNonce: varchar("api_key_nonce", { length: 64 }).notNull(),
    apiKeyAuthTag: varchar("api_key_auth_tag", { length: 64 }).notNull(),
    keyVersion: integer("key_version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
);

export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 255 }).notNull().default("Percakapan baru"),
    activeConnectionId: uuid("active_connection_id").references(() => routerConnections.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [index("conversations_user_idx").on(t.userId, t.updatedAt)],
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    role: varchar("role", { length: 16 }).notNull(),
    content: jsonb("content").notNull(),
    status: varchar("status", { length: 32 }).notNull().default("complete"),
    seq: bigint("seq", { mode: "number" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("messages_conversation_seq_idx").on(t.conversationId, t.seq),
  ],
);

export const attachments = pgTable(
  "attachments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id").references(() => conversations.id, {
      onDelete: "cascade",
    }),
    messageId: uuid("message_id").references(() => messages.id, { onDelete: "set null" }),
    objectKey: varchar("object_key", { length: 512 }).notNull().unique(),
    originalName: varchar("original_name", { length: 255 }).notNull(),
    contentType: varchar("content_type", { length: 128 }).notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    checksum: varchar("checksum", { length: 128 }),
    status: varchar("status", { length: 32 }).notNull().default("uploading"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("attachments_user_idx").on(t.userId, t.createdAt)],
);

export const agentRuns = pgTable(
  "agent_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    connectionId: uuid("connection_id").references(() => routerConnections.id, {
      onDelete: "set null",
    }),
    idempotencyKey: varchar("idempotency_key", { length: 128 }),
    status: varchar("status", { length: 32 }).notNull().default("queued"),
    model: varchar("model", { length: 128 }),
    usage: jsonb("usage"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    cancelRequested: boolean("cancel_requested").notNull().default(false),
    policyVersion: integer("policy_version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("agent_runs_idempotency_idx").on(t.conversationId, t.idempotencyKey),
    index("agent_runs_conversation_idx").on(t.conversationId, t.status),
  ],
);

export const toolExecutions = pgTable(
  "tool_executions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => agentRuns.id, { onDelete: "cascade" }),
    toolCallId: varchar("tool_call_id", { length: 128 }).notNull(),
    toolName: varchar("tool_name", { length: 255 }).notNull(),
    risk: varchar("risk", { length: 32 }).notNull(),
    sanitizedInput: jsonb("sanitized_input"),
    resultSummary: text("result_summary"),
    status: varchar("status", { length: 32 }).notNull(),
    durationMs: integer("duration_ms"),
    errorCode: varchar("error_code", { length: 64 }),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("tool_executions_call_idx").on(t.runId, t.toolCallId)],
);

export const changeTransactions = pgTable(
  "change_transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => routerConnections.id, { onDelete: "cascade" }),
    routerIdentity: varchar("router_identity", { length: 255 }),
    runId: uuid("run_id").references(() => agentRuns.id, { onDelete: "set null" }),
    state: varchar("state", { length: 32 }).notNull().default("preparing"),
    lockOwner: varchar("lock_owner", { length: 128 }),
    verification: jsonb("verification"),
    outcome: varchar("outcome", { length: 32 }),
    recoveryMetadata: jsonb("recovery_metadata"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("change_transactions_conn_idx").on(t.connectionId, t.state)],
);

export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    action: varchar("action", { length: 128 }).notNull(),
    connectionId: uuid("connection_id"),
    runId: uuid("run_id"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("audit_events_user_time_idx").on(t.userId, t.createdAt),
    index("audit_events_connection_time_idx").on(t.connectionId, t.createdAt),
  ],
);
