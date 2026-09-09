import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import { routerConnections, workspaces } from "./schema-core";
import { agentRuns, conversations } from "./schema-chat";

// ── Configuration Preview & Approval ────────────────────────────────────
export const approvalRequests = sqliteTable(
  "approval_requests",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    connectionId: text("connection_id")
      .notNull()
      .references(() => routerConnections.id, { onDelete: "cascade" }),
    runId: text("run_id").references(() => agentRuns.id, { onDelete: "set null" }),
    conversationId: text("conversation_id").references(() => conversations.id, { onDelete: "set null" }),
    status: text("status").notNull().default("pending"), // pending | approved | rejected | expired | executed | failed
    summary: text("summary").notNull(),
    operations: text("operations", { mode: "json" }).notNull(), // Array of { command, description, risk }
    riskLevel: text("risk_level").notNull().default("medium"), // low | medium | high | critical
    impactDescription: text("impact_description"),
    affectedObjects: text("affected_objects", { mode: "json" }),
    operationsHash: text("operations_hash").notNull(),
    approvedOperationsHash: text("approved_operations_hash"),
    approvedAt: integer("approved_at", { mode: "timestamp_ms" }),
    rejectedAt: integer("rejected_at", { mode: "timestamp_ms" }),
    rejectedReason: text("rejected_reason"),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    executedAt: integer("executed_at", { mode: "timestamp_ms" }),
    executionResult: text("execution_result", { mode: "json" }),
    executionError: text("execution_error"),
    preBackupId: text("pre_backup_id"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  },
  (t) => [
    index("approval_requests_user_status_idx").on(t.userId, t.status, t.createdAt),
    index("approval_requests_conn_idx").on(t.connectionId, t.createdAt),
    index("approval_requests_run_idx").on(t.runId),
  ],
);

export const approvalOperationLog = sqliteTable(
  "approval_operation_log",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    approvalId: text("approval_id")
      .notNull()
      .references(() => approvalRequests.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    command: text("command").notNull(),
    status: text("status").notNull().default("pending"), // pending | success | failed | skipped
    output: text("output"),
    errorMessage: text("error_message"),
    durationMs: integer("duration_ms"),
    executedAt: integer("executed_at", { mode: "timestamp_ms" }),
  },
  (t) => [
    index("approval_op_log_approval_idx").on(t.approvalId, t.seq),
  ],
);
