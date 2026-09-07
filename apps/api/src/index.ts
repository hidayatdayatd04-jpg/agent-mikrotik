import { resolve } from "node:path";
import { serveStatic } from "hono/bun";
import { bodyLimit } from "hono/body-limit";
import { ensureLocalKey } from "./lib/local-files";
import { sessionAuth } from "./middleware/session";
import { ensureSeedAccount } from "./services/auth";
import { localOnly } from "./middleware/local-only";
import { Hono } from "hono";
import { loadConfig } from "./lib/config";
import { createLogger } from "./lib/logger";
import { AppError, errorBody, statusForCode } from "./lib/errors";
import { randomUUID } from "node:crypto";
import type { Env as HonoEnv } from "./types";
import { createDb, recoverLocalState } from "./db";
import { checkDatabase } from "./db/health";
import { createConnectorService } from "./services/connector";
import { createConnectorRoutes } from "./routes/connectors";
import { createTargetPolicy } from "./services/target-policy";
import { envKeyRing } from "./lib/crypto";
import { McpSupervisor } from "./mcp/supervisor";
import { makeSpawnPlan } from "./mcp/spawn-plan";
import { RosettaProcess } from "./mcp/rosetta";
import { createRequire } from "node:module";
import { createAuthRoutes } from "./routes/auth";
import { createActivityRoutes } from "./routes/activities";
import { createCompactionRoutes } from "./routes/compaction";
import { createTerminalRoutes } from "./routes/terminal";
import { createPreferencesRoutes } from "./routes/preferences";

const config = loadConfig();
const logger = createLogger(config.LOG_LEVEL);
const db = createDb(resolve(config.DATA_DIR, "agent.sqlite"));
recoverLocalState(db);

const nodeRequire = createRequire(import.meta.url);

function resolveRosettaCli(): string {
  // rosetta has no "main"/"exports"; resolve the bin entry directly from node_modules.
  return nodeRequire.resolve("@tikoci/rosetta/bin/rosetta.js");
}

const keyRing = envKeyRing({ 1: ensureLocalKey(config.DATA_DIR) }, 1);

const supervisor = new McpSupervisor(
  makeSpawnPlan(config.MCP_BUN_EXECUTABLE),
  {
    maxPerUser: config.MAX_MCP_PROCESSES_PER_USER,
    total: config.MAX_MCP_PROCESSES_TOTAL,
    idleTimeoutMs: config.MCP_IDLE_TIMEOUT_SECONDS * 1000,
    startupTimeoutMs: 30_000,
  },
  logger,
);

const rosettaCli = resolveRosettaCli();
const rosetta = new RosettaProcess({
  bunExecutable: config.MCP_BUN_EXECUTABLE,
  rosettaCliPath: rosettaCli,
  dbPath: config.rosettaDbPath,
  logger,
});

const connectors = createConnectorService({
  db,
  keyRing,
  targetPolicy: createTargetPolicy(config.routerAllowedCidrs),
  sshTimeoutMs: config.SSH_CONNECT_TIMEOUT_MS,
  log: (msg, data) => logger.info(msg, data),
});

// Policy dispatcher (M5): single execution path for all tool calls.
import { normalizeCustomTools } from "./policies/normalize";
import { createLiveCatalogSource } from "./policies/live-catalog";
import { PolicyDispatcher } from "./policies/dispatcher";
import { customManifests } from "@mikrotik-tools/index";
import { auditEvents, attachments } from "./db/schema";
import { and, eq } from "drizzle-orm";
import { ZodSchemaValidator } from "./policies/schema-validator";
import { TransactionCoordinator } from "./transactions/coordinator";
import { createSafeModeSessionFactory } from "./transactions/mcp-session";
import { createTransactionRoutes } from "./routes/transactions";

const customTools = normalizeCustomTools(customManifests());
const catalogSource = createLiveCatalogSource({
  // system-level children: the supervisor respawns per (user,connection) specs
  // with the right mode when agent runs request them; these cover catalog
  // discovery for policy decisions.
  getFullChild: () => supervisor.getOrSpawn({ connectionId: "catalog-full", userId: "system", host: "catalog", port: 22, username: "catalog", password: null, hostKeyFingerprint: null, readOnly: false }),
  getReadOnlyChild: () => supervisor.getOrSpawn({ connectionId: "catalog-readonly", userId: "system", host: "catalog", port: 22, username: "catalog", password: null, hostKeyFingerprint: null, readOnly: true }),
  rosettaToolNames: async () => {
    const tools = (await rosetta.listTools()) as { name: string; description?: string; inputSchema?: unknown }[];
    return tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }));
  },
  customTools,
});

const dispatcher = new PolicyDispatcher({
  modeSource: {
    getMode: (userId, connectionId) => connectors.getMode(userId, connectionId),
  },
  catalog: catalogSource,
  validator: new ZodSchemaValidator(),
  audit: (event) => {
    void db
      .insert(auditEvents)
      .values({
        userId: event.userId === "system" ? null : event.userId,
        action: `tool.${event.decision}`,
        metadata: { tool: event.tool, code: event.code ?? null },
      })
      .catch((err: unknown) => logger.error("audit insert failed", { message: err instanceof Error ? err.message : String(err) }));
  },
});

// M6 transaction coordinator: backend-only safe-mode state machine.
const safeModeSessions = createSafeModeSessionFactory({
  supervisor,
  logger,
  getConnection: async (userId, connectionId) => {
    const row = await connectors.requireOwned(userId, connectionId)();
    const password = await connectors.decryptCredential(userId, connectionId);
    return {
      userId,
      connectionId,
      spec: {
        host: row.host,
        port: row.port,
        username: row.username,
        password,
        hostKeyFingerprint: row.hostKeyFingerprint,
      },
    };
  },
});

const txCoordinator = new TransactionCoordinator({
  db,
  logger,
  maxActionsPerTransaction: config.MAX_ACTIONS_PER_TRANSACTION,
  openSession: (ctx) => safeModeSessions.openSession(ctx),
  openVerifiedSession: (ctx) => safeModeSessions.openVerifiedSession(ctx),
  verifyChecks: (ctx) => safeModeSessions.verifyManagement(ctx),
});

// M7: AI provider (multi-provider OpenAI-compatible; Gemini/OpenRouter/custom
// per user; mock deterministik bila belum dikonfigurasi).
import { createProviderSettingsService } from "./agent/provider-settings";
import { createOpenAiCompatibleClient, createMockClient } from "./agent/chat-client";
import { buildSystemInstruction } from "./agent/instructions";
import { createAgentLoop } from "./agent/loop";
import { RunEventHub } from "./agent/hub";
import { createToolExecutor } from "./agent/tool-executor";
import { createAiProviderRoutes } from "./routes/ai-provider";
import { createChatRoutes } from "./routes/chat";
import { createAttachmentRoutes } from "./routes/attachments";
import { createStorageService, detectContentKind } from "./services/storage";
import { globalCheckpoints, globalRateLimiter } from "./agent/rate-limiter";
import { parseRateLimitOverrides } from "./lib/config";
import { createFallbackChatClient, type FallbackCandidate } from "./agent/model-fallback";

const providerSettings = createProviderSettingsService({ db, keyRing, logger });
// Rate limiter terpusat untuk seluruh model/provider (chat, retry, background).
{
  const overrides = parseRateLimitOverrides(config.RATE_LIMIT_OVERRIDES_JSON);
  globalRateLimiter.setDefaults({ rpm: config.RATE_LIMIT_RPM, tpm: config.RATE_LIMIT_TPM });
  for (const [k, v] of Object.entries(overrides.providerOverrides)) globalRateLimiter.setProviderOverride(k, v);
  for (const [k, v] of Object.entries(overrides.modelOverrides)) globalRateLimiter.setModelOverride(k, v);
  for (const [k, v] of Object.entries(overrides.sharedOverrides)) globalRateLimiter.setSharedOverride(k, v);
}

/** Bungkus client OpenAI-compatible dengan fallback antar model (read-only safe). */
function makeRateLimitedClient(
  cfg: import("./agent/provider-settings").ProviderConfigWithKey,
  fallbackCandidates: FallbackCandidate[] = [],
  runContext?: { runId: string | null; conversationId: string | null; userId: string | null; userText: string | null; policyMode: "read-only" | "write" },
) {
  const base = (c: FallbackCandidate) => {
    // Kandidat membawa baseUrl/name sendiri bila dari fallback list; primer memakai cfg.
    const isPrimary = `${c.providerKind}:${c.model}` === `${cfg.kind}:${cfg.model}`;
    const effective = isPrimary
      ? cfg
      : {
          ...cfg,
          kind: c.providerKind as typeof cfg.kind,
          model: c.model,
          baseUrl: (c as { baseUrl?: string }).baseUrl ?? cfg.baseUrl,
          name: (c as { name?: string }).name ?? cfg.name,
          apiKey: c.apiKey ?? cfg.apiKey,
        };
    return createOpenAiCompatibleClient(effective, logger, { limiter: globalRateLimiter });
  };
  if (fallbackCandidates.length === 0) return base({ providerId: cfg.id ?? cfg.kind, providerKind: cfg.kind, model: cfg.model, enabled: true, apiKey: cfg.apiKey });
  const primary: FallbackCandidate = { providerId: cfg.id ?? cfg.kind, providerKind: cfg.kind, model: cfg.model, enabled: true, apiKey: cfg.apiKey };
  return createFallbackChatClient(primary, fallbackCandidates, base, { limiter: globalRateLimiter, checkpoints: globalCheckpoints, logger, runContext });
}
const executeTool = createToolExecutor({ supervisor, connectors, logger });
const executeDocsTool = async (input: { fqName: string; args: unknown }): Promise<{ ok: boolean; output: string; errorCode?: string }> => {
  const rawName = input.fqName.includes(":") ? input.fqName.split(":")[1]! : input.fqName;
  try {
    const args = (input.args ?? {}) as Record<string, unknown>;
    if (rawName === "routeros_search") {
      const query = String(args.query ?? "").slice(0, 256);
      const limit = Math.min(Math.max(Number(args.limit ?? 5), 1), 10);
      const result = await rosetta.call("routeros_search", { query, limit });
      return { ok: true, output: JSON.stringify(result).slice(0, 6000) };
    }
    return { ok: false, output: `Tool dokumentasi ${rawName} tidak dikenal.`, errorCode: "TOOL_UNSUPPORTED" };
  } catch (err) {
    return { ok: false, output: err instanceof Error ? err.message : String(err), errorCode: "TOOL_FAILED" };
  }
};
const hub = new RunEventHub();

const agentLoop = createAgentLoop({
  db,
  logger,
  dispatcher,
  txCoordinator,
  catalog: catalogSource,
  limits: {
    maxSteps: config.AGENT_MAX_STEPS,
    maxToolCalls: config.AGENT_MAX_TOOL_CALLS,
    runTimeoutMs: config.AGENT_RUN_TIMEOUT_MS,
    maxTokens: 4096,
  },
});

const connectorRoutes = createConnectorRoutes({ connectors, supervisor, txCoordinator, safeModeSessions, logger, invalidateCatalog: () => catalogSource.invalidate() });
const transactionRoutes = createTransactionRoutes({ coordinator: txCoordinator, connectors, db, logger });
const aiProviderRoutes = createAiProviderRoutes({ providers: providerSettings, logger, limiter: globalRateLimiter, checkpoints: globalCheckpoints });
const storage = createStorageService({ directory: config.DATA_DIR });
const attachmentRoutes = createAttachmentRoutes({
  db,
  logger,
  storage,
  limits: { maxBytes: config.UPLOAD_MAX_BYTES, maxFilesPerMessage: config.UPLOAD_MAX_FILES_PER_MESSAGE },
});
const chatRoutes = createChatRoutes({
  db,
  logger,
  loop: agentLoop,
  hub,
  connectors,
  transactions: txCoordinator,
  getProvider: (userId, model, providerId) => providerSettings.resolveForRun(userId, { model, providerId }),
  getFallbackCandidates: (userId, model, providerId) =>
    providerSettings.listFallbackCandidates(userId, { model, providerId }) as Promise<FallbackCandidate[]>,
  makeClient: (cfg, fallbackCandidates, runContext) => makeRateLimitedClient(cfg, fallbackCandidates ?? [], runContext),
  makeMockClient: () => createMockClient(),
  executeTool,
  executeDocsTool,
  buildInstruction: buildSystemInstruction,
  loadAttachmentContent: async (input) => {
    if (!storage) return null;
    const [row] = await db
      .select()
      .from(attachments)
      .where(and(eq(attachments.id, input.attachmentId), eq(attachments.userId, input.userId)))
      .limit(1);
    if (!row || row.status !== "ready") return null;
    try {
      const obj = await storage.get(row.objectKey);
      const sniff = detectContentKind({ mimeType: row.contentType, originalName: row.originalName, head: obj.body.subarray(0, 512) });
      return { kind: sniff.ok ? sniff.kind : "unsupported", name: row.originalName, mime: row.contentType, bytes: obj.body };
    } catch {
      return null;
    }
  },
  removeAttachmentObject: async (input) => {
    if (!storage) return;
    // object keys are server-generated under attachments/{userId}/ — the
    // userId scoping here is defense-in-depth against a forged key
    if (!input.objectKey.startsWith(`attachments/${input.userId}/`)) return;
    await storage.remove(input.objectKey);
  },
  limits: {
    maxSteps: config.AGENT_MAX_STEPS,
    maxToolCalls: config.AGENT_MAX_TOOL_CALLS,
    runTimeoutMs: config.AGENT_RUN_TIMEOUT_MS,
    maxTokens: 4096,
  },
  runRateLimit: { maxRuns: 20, windowMs: 60_000 },
});

void ensureSeedAccount(db, logger).catch((err) =>
  logger.error("seed account failed", { message: err instanceof Error ? err.message : String(err) }),
);

const app = new Hono<HonoEnv>();

app.use(async (c, next) => {
  c.set("requestId", randomUUID());
  c.set("config", config);
  c.set("logger", logger);
  c.set("db", db);
  c.set("dispatcher", dispatcher);
  c.set("workspace", null);
  c.set("account", null);
  c.set("sessionId", null);
  await next();
});

app.use("*", localOnly(config.API_PORT, !config.isProduction));
app.use("*", sessionAuth(db));
app.use("/api/*", bodyLimit({ maxSize: config.UPLOAD_MAX_BYTES + 1024 * 1024 }));
const authRoutes = createAuthRoutes({ db, logger });
const activityRoutes = createActivityRoutes({ db });
const compactionRoutes = createCompactionRoutes({
  db,
  logger,
  getProviderClient: async (userId: string) => {
    const cfg = await providerSettings.resolveForRun(userId, {});
    if (!cfg) return null;
    // Background task wajib lewat limiter terpusat yang sama (#1).
    return { client: createOpenAiCompatibleClient(cfg, logger, { limiter: globalRateLimiter }), model: cfg.model, provider: cfg.kind };
  },
});
const terminalRoutes = createTerminalRoutes({ db, logger, connectors, transactions: txCoordinator });
const preferencesRoutes = createPreferencesRoutes({ db, logger });
app.route("/api/auth", authRoutes);
app.route("/api/preferences", preferencesRoutes);
app.route("/api/terminal", terminalRoutes);
app.route("/api/connectors", connectorRoutes);
app.route("/api/transactions", transactionRoutes);
app.route("/api/ai-provider", aiProviderRoutes);
app.route("/api/attachments", attachmentRoutes);
app.route("/", activityRoutes);
app.route("/", compactionRoutes);
app.route("/", chatRoutes);

app.onError((err, c) => {
  const log = c.get("logger");
  if (err instanceof AppError) {
    if (statusForCode(err.code) >= 500) log.error(`request failed: ${err.code}`, { message: err.message });
    else log.warn(`request rejected: ${err.code}`, { message: err.message });
  } else {
    log.error("unhandled error", { message: err instanceof Error ? err.message : String(err) });
  }
  const status = err instanceof AppError ? statusForCode(err.code) : 500;
  return c.json(errorBody(c, err), status as 500);
});

app.notFound((c) => {
  const body = errorBody(c, new AppError("NOT_FOUND", "Endpoint tidak ditemukan", 404));
  return c.json(body, 404);
});

app.get("/health/live", (c) => c.json({ status: "ok" }));

app.get("/health/ready", async (c) => {
  const database = await checkDatabase(c.get("db"));
  const ready = database === "ok";
  return c.json(
    {
      status: ready ? "ok" : "degraded",
      checks: { database },
    },
    ready ? 200 : 503,
  );
});

app.get("/api/ping", (c) => c.json({ pong: true, requestId: c.get("requestId") }));

// Documentation search through the shared Rosetta process (no router credentials involved).
app.get("/api/tools/rosetta", async (c) => {
  const tools = await rosetta.listTools();
  return c.json({
    tools: tools.map((t) => ({
      name: (t as { name?: string }).name ?? "",
      description: ((t as { description?: string }).description ?? "").slice(0, 200),
    })),
  });
});

app.post("/api/tools/rosetta/search", async (c) => {
  const body = (await c.req.json().catch(() => null)) as { query?: string } | null;
  const query = body?.query?.trim();
  if (!query || query.length > 256) {
    throw new AppError("VALIDATION_FAILED", "Query pencarian wajib 1-256 karakter.", 422);
  }
  const result = await rosetta.call("routeros_search", { query, limit: 5 });
  return c.json({ result });
});

const webRoot = process.env.MIKROTIK_WEB_DIR ?? resolve(import.meta.dir, "../../web/dist");
app.get("*", async (c, next) => {
  if (c.req.path.startsWith("/api/") || c.req.path.startsWith("/health/")) return next();
  return serveStatic({ root: webRoot })(c, next);
});
app.get("*", async (c, next) => {
  if (c.req.path.startsWith("/api/") || c.req.path.startsWith("/health/")) return next();
  return serveStatic({ path: resolve(webRoot, "index.html") })(c, next);
});

const port = config.API_PORT;
logger.info(`starting api server on :${port}`, {
  nodeEnv: config.NODE_ENV,
  mockProvider: config.useMockProvider,
});

export default {
  port,
  hostname: "127.0.0.1",
  fetch: app.fetch,
  app,
  // graceful shutdown (Docker SIGTERM): stop supervised MCP children so no
  // orphan ssh processes survive the container; in-flight SSE writes drain.
};

// Bun serves `export default`; signal handlers run alongside.
const shutdown = async (signal: string) => {
  logger.info("graceful shutdown started", { signal });
  try {
    await supervisor.shutdownAll();
    await rosetta.shutdown();
  } catch (err) {
    logger.error("supervisor shutdown error", { message: err instanceof Error ? err.message : String(err) });
  }
  logger.info("graceful shutdown complete", { signal });
  process.exit(0);
};
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
