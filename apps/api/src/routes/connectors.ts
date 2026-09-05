import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import type { Env } from "../types";
import { AppError } from "../lib/errors";
import { RouterModeSchema } from "@shared/index";
import type { ConnectorService } from "../services/connector";
import type { McpSupervisor } from "../mcp/supervisor";
import type { SessionContext } from "../services/auth";

const HostSchema = z
  .string()
  .min(1)
  .max(255)
  .regex(/^[a-zA-Z0-9._-]+$/, "host hanya boleh berisi huruf, angka, titik, strip, underscore");

const CreateSchema = z.object({
  label: z.string().min(1).max(200),
  host: HostSchema,
  port: z.number().int().min(1).max(65535).default(22),
  username: z.string().min(1).max(128),
  password: z.string().min(1).max(512),
});

const PatchSchema = z.object({
  label: z.string().min(1).max(200).optional(),
  host: HostSchema.optional(),
  port: z.number().int().min(1).max(65535).optional(),
  username: z.string().min(1).max(128).optional(),
  password: z.string().min(1).max(512).optional(),
});

const ModeSchema = z.object({
  mode: RouterModeSchema,
  expectedVersion: z.number().int().min(1),
});

export function createConnectorRoutes(deps: {
  connectors: ConnectorService;
  supervisor: McpSupervisor;
}) {
  const routes = new Hono<Env>();

  routes.get("/", async (c) => {
    const session = requireSession(c);
    const list = await deps.connectors.list(session.userId);
    return c.json({ connectors: list });
  });

  routes.post("/", zValidator("json", CreateSchema), async (c) => {
    const session = requireSession(c);
    const input = c.req.valid("json");
    const { connector, probe } = await deps.connectors.create(session.userId, input);
    return c.json({ connector, probe: { ok: probe.ok, routerIdentity: probe.routerIdentity } }, 201);
  });

  routes.patch("/:id", zValidator("json", PatchSchema), async (c) => {
    const session = requireSession(c);
    const input = c.req.valid("json");
    const { connector, probe } = await deps.connectors.update(session.userId, c.req.param("id"), input);
    return c.json({ connector, probe: { ok: probe.ok, routerIdentity: probe.routerIdentity } });
  });

  routes.post("/:id/connect", async (c) => {
    const session = requireSession(c);
    const connector = await deps.connectors.connect(session.userId, c.req.param("id"));
    return c.json({ connector });
  });

  routes.post("/:id/disconnect", async (c) => {
    const session = requireSession(c);
    // stop the supervised MCP process and revoke write
    await deps.supervisor.stop(session.userId, c.req.param("id"));
    const connector = await deps.connectors.disconnect(session.userId, c.req.param("id"));
    return c.json({ connector });
  });

  routes.patch("/:id/mode", zValidator("json", ModeSchema), async (c) => {
    const session = requireSession(c);
    const { mode, expectedVersion } = c.req.valid("json");
    // mode change requires the connector to be connected and verified
    const result = await deps.connectors.setMode(session.userId, c.req.param("id"), mode, expectedVersion);
    return c.json({ connector: result.connector, version: result.version });
  });

  routes.get("/:id/mode", async (c) => {
    const session = requireSession(c);
    const result = await deps.connectors.getMode(session.userId, c.req.param("id"));
    return c.json(result);
  });

  routes.delete("/:id", async (c) => {
    const session = requireSession(c);
    await deps.supervisor.stop(session.userId, c.req.param("id"));
    await deps.connectors.remove(session.userId, c.req.param("id"));
    return c.json({ ok: true });
  });

  function requireSession(c: { get: (k: "session") => unknown }): SessionContext {
    const s = c.get("session");
    if (!s) throw new AppError("AUTH_REQUIRED", "Silakan masuk terlebih dahulu.", 401);
    return s as SessionContext;
  }

  return routes;
}
