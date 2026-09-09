import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import { routerConnections, workspaces } from "./schema-core";
import { agentRuns } from "./schema-chat";

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
