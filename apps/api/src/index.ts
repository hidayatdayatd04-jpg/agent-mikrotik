import { resolve } from "node:path";
import { serveStatic } from "hono/bun";
import { bodyLimit } from "hono/body-limit";
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { sessionAuth } from "./middleware/session";
import { localOnly } from "./middleware/local-only";
import { ensureSeedAccount } from "./services/auth";
import { AppError, errorBody, statusForCode } from "./lib/errors";
import type { Env as HonoEnv } from "./types";
import { config, db, logger, rosetta, supervisor } from "./bootstrap/foundation";
import { dispatcher } from "./bootstrap/policy";
import "./bootstrap/ai";
import { mountApiRoutes } from "./bootstrap/api-routes";
import { mountChatRoutes } from "./bootstrap/chat-routes";
import { checkDatabase } from "./db/health";

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

mountApiRoutes(app);
mountChatRoutes(app);

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
