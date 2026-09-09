import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import { routerConnections, workspaces } from "./schema-core";
import { conversations } from "./schema-chat";
import { changeTransactions } from "./schema-transactions";

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
