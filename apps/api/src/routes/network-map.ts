import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../types";
import { requireWorkspace } from "../middleware/session";
import { AppError } from "../lib/errors";
import type { NetworkMapService } from "../services/network-map";

export function createNetworkMapRoutes(service: NetworkMapService) {
  const routes = new Hono<Env>();
  routes.get("/:id", async c => {
    const { userId } = requireWorkspace(c);
    const input = z.object({ id: z.string().uuid(), refresh: z.enum(["0", "1"]).optional() })
      .safeParse({ id: c.req.param("id"), refresh: c.req.query("refresh") });
    if (!input.success) throw new AppError("VALIDATION_FAILED", "Parameter Network Map tidak valid.", 422);
    c.header("Cache-Control", "no-store");
    return c.json(await service.read(userId, input.data.id, input.data.refresh === "1"));
  });
  return routes;
}
