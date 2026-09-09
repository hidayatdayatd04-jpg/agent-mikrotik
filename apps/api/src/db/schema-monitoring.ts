import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import { routerConnections, workspaces } from "./schema-core";

// ── Monitoring ──────────────────────────────────────────────────────────
export const monitoringSnapshots = sqliteTable(
  "monitoring_snapshots",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    connectionId: text("connection_id")
      .notNull()
      .references(() => routerConnections.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    type: text("type").notNull(), // resource | traffic | interface
    data: text("data", { mode: "json" }).notNull(),
    collectedAt: integer("collected_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  },
  (t) => [
    index("monitoring_snapshots_conn_time_idx").on(t.connectionId, t.type, t.collectedAt),
    index("monitoring_snapshots_user_idx").on(t.userId, t.collectedAt),
  ],
);

// ── Notifications ───────────────────────────────────────────────────────
export const notifications = sqliteTable(
  "notifications",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    connectionId: text("connection_id").references(() => routerConnections.id, { onDelete: "set null" }),
    type: text("type").notNull().default("info"), // info | success | warning | critical
    category: text("category").notNull(), // router_status | resource | interface | backup | config | agent
    title: text("title").notNull(),
    message: text("message").notNull(),
    read: integer("read", { mode: "boolean" }).notNull().default(false),
    routerLabel: text("router_label"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
    readAt: integer("read_at", { mode: "timestamp_ms" }),
  },
  (t) => [
    index("notifications_user_read_idx").on(t.userId, t.read, t.createdAt),
    index("notifications_user_time_idx").on(t.userId, t.createdAt),
    index("notifications_dedup_idx").on(t.userId, t.connectionId, t.category, t.type),
  ],
);

export const notificationSettings = sqliteTable(
  "notification_settings",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    cpuThreshold: integer("cpu_threshold").notNull().default(90),
    ramThreshold: integer("ram_threshold").notNull().default(85),
    cooldownMs: integer("cooldown_ms").notNull().default(300_000), // 5 minutes
    enabledCategories: text("enabled_categories", { mode: "json" })
      .notNull()
      .$defaultFn(() => ["router_status", "resource", "interface", "backup", "config", "agent"]),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  },
);
