import { sqliteTable, text, integer, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import { agentRuns } from "./schema-chat";
import { conversations } from "./schema-chat";

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
