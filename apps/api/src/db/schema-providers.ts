import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import { workspaces } from "./schema-core";

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

// Web Search (Tavily) settings: satu API key per workspace, disimpan terenkripsi
// AES-256-GCM dengan keyRing yang sama dipakai kredensial router & provider AI.
export const webSearchSettings = sqliteTable("web_search_settings", {
  userId: text("user_id")
    .primaryKey()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  provider: text("provider").notNull().default("tavily"),
  apiKeyCiphertext: text("api_key_ciphertext").notNull(),
  apiKeyNonce: text("api_key_nonce").notNull(),
  apiKeyAuthTag: text("api_key_auth_tag").notNull(),
  keyVersion: integer("key_version").notNull().default(1),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

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
