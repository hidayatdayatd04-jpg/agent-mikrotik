import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import type { Env } from "../types";
import { AppError } from "../lib/errors";
import { requireWorkspace } from "../middleware/session";
import type { WebSearchSettingsService } from "../agent/web-search-settings";
import { verifyTavilyApiKey } from "../agent/web-search-tool";

/**
 * Web Search (Tavily) settings: GET status / POST simpan (test-before-save) /
 * DELETE hapus. API key tidak pernah dikembalikan dalam bentuk plaintext.
 */
export function createWebSearchSettingsRoutes(deps: { settings: WebSearchSettingsService }) {
  const routes = new Hono<Env>();

  routes.get("/", async (c) => {
    const workspace = requireWorkspace(c);
    return c.json(await deps.settings.getStatus(workspace.userId));
  });

  const SaveSchema = z.object({ apiKey: z.string().min(8).max(256) });
  routes.post("/", zValidator("json", SaveSchema), async (c) => {
    const workspace = requireWorkspace(c);
    const { apiKey } = c.req.valid("json");
    // Test-before-save — pola sama seperti probe SSH sebelum kredensial router disimpan.
    const check = await verifyTavilyApiKey(apiKey);
    if (!check.ok) throw new AppError("VALIDATION_FAILED", check.message ?? "API key Tavily tidak valid.", 422);
    return c.json(await deps.settings.save(workspace.userId, apiKey));
  });

  routes.delete("/", async (c) => {
    const workspace = requireWorkspace(c);
    await deps.settings.remove(workspace.userId);
    return c.json({ ok: true });
  });

  return routes;
}