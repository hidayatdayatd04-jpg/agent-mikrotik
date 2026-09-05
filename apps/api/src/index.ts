import { Hono } from "hono";
import { loadConfig } from "./lib/config";
import { createLogger } from "./lib/logger";
import { AppError, errorBody, statusForCode } from "./lib/errors";
import { randomUUID } from "node:crypto";
import type { Env as HonoEnv } from "./types";
import { createDb } from "./db";
import { checkDatabase } from "./db/health";
import { createAuthService, MockEmailSender, type EmailSender } from "./services/auth";
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

const email: EmailSender = config.useMockEmail
  ? new MockEmailSender((m, d) => logger.warn(m, d))
  : new MockEmailSender((m) => logger.warn(m)); // Brevo adapter added in M3 wiring when API key present

const auth = createAuthService(db, config, email);
const authRoutes = createAuthRoutes({ auth, email, logger, otpSecret: config.OTP_HMAC_SECRET ?? "dev-otp", db, config });
const connectorRoutes = createConnectorRoutes({ connectors, supervisor });

const app = new Hono<HonoEnv>();

app.use(async (c, next) => {
  c.set("requestId", randomUUID());
  c.set("config", config);
  c.set("logger", logger);
  c.set("db", db);
  const token = getCookie(c, SESSION_COOKIE);
  c.set("session", token ? await auth.resolveSession(token) : null);
  await next();
});

app.route("/api/auth", authRoutes);
app.route("/api/connectors", connectorRoutes);

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
