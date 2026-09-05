import { Hono } from "hono";
import { loadConfig } from "./lib/config";
import { createLogger } from "./lib/logger";
import { AppError, errorBody, statusForCode } from "./lib/errors";
import { randomUUID } from "node:crypto";
import type { Env as HonoEnv } from "./types";

const config = loadConfig();
const logger = createLogger(config.LOG_LEVEL);

const app = new Hono<HonoEnv>();

app.use(async (c, next) => {
  c.set("requestId", randomUUID());
  c.set("config", config);
  c.set("logger", logger);
  await next();
});

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
  return c.json({
    status: "ok",
    checks: {
      database: "not-configured",
    },
  });
});

app.get("/api/ping", (c) => c.json({ pong: true, requestId: c.get("requestId") }));

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
};
