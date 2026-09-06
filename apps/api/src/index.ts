import { Hono } from "hono";
import { loadConfig } from "./lib/config";
import { createLogger } from "./lib/logger";
import { AppError, errorBody, statusForCode } from "./lib/errors";
import { randomUUID } from "node:crypto";
import type { Env as HonoEnv } from "./types";
import { createDb } from "./db";
import { checkDatabase } from "./db/health";
import { createAuthService, MockEmailSender, type EmailSender } from "./services/auth";
import { BrevoSmtpSender } from "./services/brevo-smtp";
import { createAuthRoutes } from "./routes/auth";
import { createConnectorService } from "./services/connector";
import { createConnectorRoutes } from "./routes/connectors";
import { createTargetPolicy } from "./services/target-policy";
import { makeKeyRing } from "./lib/crypto";
import { McpSupervisor } from "./mcp/supervisor";
import { makeSpawnPlan } from "./mcp/spawn-plan";
import { RosettaProcess } from "./mcp/rosetta";
import { createRequire } from "node:module";
import { getCookie } from "hono/cookie";
import { SESSION_COOKIE } from "./middleware/session";

const config = loadConfig();
const logger = createLogger(config.LOG_LEVEL);
const db = createDb(config.DATABASE_URL);

const nodeRequire = createRequire(import.meta.url);

function resolveRosettaCli(): string {
  // rosetta has no "main"/"exports"; resolve the bin entry directly from node_modules.
  return nodeRequire.resolve("@tikoci/rosetta/bin/rosetta.js");
}

const keyRing = makeKeyRing(config.ROUTER_CREDENTIAL_KEY, config.ROUTER_CREDENTIAL_KEY_VERSION, config.ROUTER_CREDENTIAL_KEY_PREVIOUS, config.ROUTER_CREDENTIAL_KEY_PREVIOUS_VERSION, config.isProduction, logger);

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

const email: EmailSender = config.useMockEmail
  ? new MockEmailSender((m, d) => logger.warn(m, d))
  : new BrevoSmtpSender(
      {
        host: config.BREVO_SMTP_HOST,
        port: config.BREVO_SMTP_PORT,
        login: config.BREVO_SMTP_LOGIN!,
        smtpKey: config.BREVO_SMTP_KEY!,
        senderName: config.BREVO_SENDER_NAME,
        senderEmail: config.BREVO_SENDER_EMAIL!,
      },
      logger,
    );

const auth = createAuthService(db, config, email);
const authRoutes = createAuthRoutes({ auth, email, logger, otpSecret: config.OTP_HMAC_SECRET ?? "dev-otp", db, config });

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

const providerSettings = createProviderSettingsService({ db, keyRing, logger });
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

const connectorRoutes = createConnectorRoutes({ connectors, supervisor, txCoordinator, safeModeSessions, logger });
const transactionRoutes = createTransactionRoutes({ coordinator: txCoordinator, connectors, db, logger });
const aiProviderRoutes = createAiProviderRoutes({ providers: providerSettings, logger });
const storage = config.B2_KEY_ID && config.B2_APPLICATION_KEY && config.B2_BUCKET && config.B2_ENDPOINT && config.B2_REGION
  ? createStorageService({
      config: {
        keyId: config.B2_KEY_ID,
        applicationKey: config.B2_APPLICATION_KEY,
        bucket: config.B2_BUCKET,
        region: config.B2_REGION,
        endpoint: config.B2_ENDPOINT,
      },
      logger,
    })
  : null;
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
  getProvider: (userId) => providerSettings.getWithKey(userId),
  makeClient: (cfg) => createOpenAiCompatibleClient(cfg, logger),
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

const app = new Hono<HonoEnv>();

app.use(async (c, next) => {
  c.set("requestId", randomUUID());
  c.set("config", config);
  c.set("logger", logger);
  c.set("db", db);
  c.set("dispatcher", dispatcher);
  const token = getCookie(c, SESSION_COOKIE);
  c.set("session", token ? await auth.resolveSession(token) : null);
  await next();
});

app.route("/api/auth", authRoutes);
app.route("/api/connectors", connectorRoutes);
app.route("/api/transactions", transactionRoutes);
app.route("/api/ai-provider", aiProviderRoutes);
app.route("/api/attachments", attachmentRoutes);
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
  if (!c.get("session")) throw new AppError("AUTH_REQUIRED", "Silakan masuk terlebih dahulu.", 401);
  const tools = await rosetta.listTools();
  return c.json({
    tools: tools.map((t) => ({
      name: (t as { name?: string }).name ?? "",
      description: ((t as { description?: string }).description ?? "").slice(0, 200),
    })),
  });
});

app.post("/api/tools/rosetta/search", async (c) => {
  if (!c.get("session")) throw new AppError("AUTH_REQUIRED", "Silakan masuk terlebih dahulu.", 401);
  const body = (await c.req.json().catch(() => null)) as { query?: string } | null;
  const query = body?.query?.trim();
  if (!query || query.length > 256) {
    throw new AppError("VALIDATION_FAILED", "Query pencarian wajib 1-256 karakter.", 422);
  }
  const result = await rosetta.call("routeros_search", { query, limit: 5 });
  return c.json({ result });
});

const port = config.API_PORT;
logger.info(`starting api server on :${port}`, {
  nodeEnv: config.NODE_ENV,
  mockEmail: config.useMockEmail,
  mockProvider: config.useMockProvider,
  mockOAuth: config.useMockOAuth,
});

export default {
  port,
  fetch: app.fetch,
  app,
};
