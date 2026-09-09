import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import { workspaces } from "./schema-core";

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
