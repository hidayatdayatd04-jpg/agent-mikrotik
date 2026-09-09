import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import { routerConnections, workspaces } from "./schema-core";

// ── Configuration Backups ───────────────────────────────────────────────
export const configBackups = sqliteTable(
  "config_backups",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    connectionId: text("connection_id")
      .notNull()
      .references(() => routerConnections.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    type: text("type").notNull().default("export_text"), // export_text | binary_backup
    routerIdentity: text("router_identity"),
    rosVersion: text("ros_version"),
    boardName: text("board_name"),
    content: text("content"), // redacted export text; null for binary
    contentHash: text("content_hash"),
    sizeBytes: integer("size_bytes").notNull().default(0),
    status: text("status").notNull().default("in_progress"), // completed | failed | in_progress
    createdBy: text("created_by").notNull().default("user"), // user | system | agent
    errorMessage: text("error_message"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  },
  (t) => [
    index("config_backups_conn_time_idx").on(t.connectionId, t.createdAt),
    index("config_backups_user_idx").on(t.userId, t.createdAt),
  ],
);

export const backupSettings = sqliteTable(
  "backup_settings",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    maxBackupsPerRouter: integer("max_backups_per_router").notNull().default(20),
    autoBackupBeforeChange: integer("auto_backup_before_change", { mode: "boolean" }).notNull().default(true),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  },
);
