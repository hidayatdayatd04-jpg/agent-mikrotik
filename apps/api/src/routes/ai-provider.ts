import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import type { Env } from "../types";
import { AppError } from "../lib/errors";
import type { ProviderSettingsService, ProviderKind } from "../agent/provider-settings";
import { fetchProviderModels } from "../agent/model-fetch";
import type { Logger } from "../lib/logger";
import type { SessionContext } from "../services/auth";

/**
 * AI provider settings + model auto-fetch (M7 revision). The API key is
 * submitted once to save, or transiently to fetch models — it is never
 * returned by any GET.
 */
export function createAiProviderRoutes(deps: {
  providers: ProviderSettingsService;
  logger: Logger;
}) {
  const routes = new Hono<Env>();

  const SaveSchema = z.object({
    kind: z.enum(["gemini", "openrouter", "custom"]),
    baseUrl: z.string().max(512).optional(),
    model: z.string().min(1).max(255),
    apiKey: z.string().min(8).max(512),
  });

  const FetchModelsSchema = z.object({
    kind: z.enum(["gemini", "openrouter", "custom"]),
    baseUrl: z.string().max(512).optional(),
    apiKey: z.string().min(8).max(512),
  });

  routes.get("/", async (c) => {
    const session = requireSession(c);
    const settings = await deps.providers.getPublic(session.userId);
    return c.json({ provider: settings });
  });

  routes.post("/", zValidator("json", SaveSchema), async (c) => {
    const session = requireSession(c);
    const input = c.req.valid("json");
    const saved = await deps.providers.save(session.userId, input);
    return c.json({ provider: saved });
  });

  routes.delete("/", async (c) => {
    const session = requireSession(c);
    await deps.providers.remove(session.userId);
    return c.json({ ok: true });
  });

  /**
   * Auto-fetch model list from the provider. Key is used transiently here and
   * never stored by this endpoint. Response models can be selected in the UI
   * or typed manually.
   */
  routes.post("/models", zValidator("json", FetchModelsSchema), async (c) => {
    requireSession(c); // authenticated only; key is transient and never stored here
    const input = c.req.valid("json");
    const result = await fetchProviderModels({
      kind: input.kind as ProviderKind,
      baseUrl: input.baseUrl,
      apiKey: input.apiKey,
      logger: deps.logger,
    });
    return c.json({ models: result.models, source: result.source });
  });

  function requireSession(c: { get: (k: "session") => unknown }): SessionContext {
    const s = c.get("session");
    if (!s) throw new AppError("AUTH_REQUIRED", "Silakan masuk terlebih dahulu.", 401);
    return s as SessionContext;
  }

  return routes;
}
