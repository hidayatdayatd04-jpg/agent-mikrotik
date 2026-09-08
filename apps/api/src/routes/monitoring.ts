import { Hono } from "hono";
import type { Env as HonoEnv } from "../types";
import { AppError } from "../lib/errors";
import type { MonitoringService } from "../services/monitoring";

export function createMonitoringRoutes(deps: { monitoring: MonitoringService }) {
  const app = new Hono<HonoEnv>();

  // GET /api/monitoring/:connectionId/live
  app.get("/:connectionId/live", async (c) => {
    const workspace = c.get("workspace");
    if (!workspace) throw new AppError("UNAUTHORIZED", "Login diperlukan.", 401);
    const connectionId = c.req.param("connectionId");
    const data = await deps.monitoring.fetchLive(workspace.userId, connectionId);
    return c.json(data);
  });

  // GET /api/monitoring/:connectionId/history
  app.get("/:connectionId/history", async (c) => {
    const workspace = c.get("workspace");
    if (!workspace) throw new AppError("UNAUTHORIZED", "Login diperlukan.", 401);
    const connectionId = c.req.param("connectionId");
    const range = (c.req.query("range") ?? "1h") as "1h" | "24h" | "7d";
    if (!["1h", "24h", "7d"].includes(range)) {
      throw new AppError("VALIDATION_FAILED", "Range harus 1h, 24h, atau 7d.", 422);
    }
    const history = await deps.monitoring.getHistory(workspace.userId, connectionId, range);
    return c.json({ history });
  });

  // POST /api/monitoring/:connectionId/refresh
  app.post("/:connectionId/refresh", async (c) => {
    const workspace = c.get("workspace");
    if (!workspace) throw new AppError("UNAUTHORIZED", "Login diperlukan.", 401);
    const connectionId = c.req.param("connectionId");
    const data = await deps.monitoring.fetchLive(workspace.userId, connectionId);
    return c.json(data);
  });

  return app;
}
