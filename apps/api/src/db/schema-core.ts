import { sqliteTable, text, integer, index, primaryKey } from "drizzle-orm/sqlite-core";

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
    rosVersion: text("ros_version"),
    boardName: text("board_name"),
    architecture: text("architecture"),
    managementInterface: text("management_interface"),
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
