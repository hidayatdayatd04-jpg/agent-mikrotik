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
import { envKeyRing } from "./lib/crypto";
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

function makeKeyRing(
  key: string | undefined,
  version: number,
  isProduction: boolean,
  log: { warn: (msg: string, data?: unknown) => void },
) {
  if (key) {
    return envKeyRing({ [version]: key }, version);
  }
  if (isProduction) {
    throw new Error("ROUTER_CREDENTIAL_KEY wajib diisi di production (base64 32 byte).");
  }
  log.warn("ROUTER_CREDENTIAL_KEY tidak diisi — memakai dev-key. Jangan pakai di production.");
  const devKey = Buffer.from("dev-only-credential-key-32bytes-padx", "utf8").subarray(0, 32).toString("base64");
  return envKeyRing({ [version]: devKey }, version);
}

const keyRing = makeKeyRing(config.ROUTER_CREDENTIAL_KEY, config.ROUTER_CREDENTIAL_KEY_VERSION, config.isProduction, logger);

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
import { auditEvents } from "./db/schema";
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
  verifyChecks: async (ctx) => {
    // pre-commit read-only health probe on the SAME child that holds the
    // safe-mode window: management plane must still answer identity reads
    try {
      const session = await safeModeSessions.openSession(ctx);
      void session;
      const row = await connectors.requireOwned(ctx.userId, ctx.connectionId)();
      void row;
      return { ok: true, detail: "management reachable" };
    } catch (err) {
      return { ok: false, detail: err instanceof Error ? err.message : String(err) };
    }
  },
});

const connectorRoutes = createConnectorRoutes({ connectors, supervisor, txCoordinator, safeModeSessions, logger });
const transactionRoutes = createTransactionRoutes({ coordinator: txCoordinator, connectors, db, logger });

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
  mockAnthropic: config.useMockAnthropic,
  mockOAuth: config.useMockOAuth,
});

export default {
  port,
  fetch: app.fetch,
  app,
};
