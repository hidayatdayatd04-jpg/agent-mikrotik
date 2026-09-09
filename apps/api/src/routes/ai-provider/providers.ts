import type { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { AppError } from "../../lib/errors";
import type { Env } from "../../types";
import type { ProviderKind } from "../../agent/provider-settings";
import { fetchProviderModels } from "../../agent/model-fetch";
import { requireWorkspace } from "../../middleware/session";
import { FetchModelsSchema, SaveSchema, SetActiveModelSchema, ToggleSchema, type AiProviderRouteCtx } from "./ctx";

/** Handler CRUD provider + konteks model + auto-fetch daftar model. */
export function registerProviderRoutes(routes: Hono<Env>, ctx: AiProviderRouteCtx) {
  const { deps, modelCache } = ctx;

  routes.get("/context", async (c) => {
    const workspace = requireWorkspace(c);
    const requestedModel = c.req.query("model");
    const requestedProviderId = c.req.query("providerId");
    const cfg = await deps.providers.resolveForRun(workspace.userId, {
      model: requestedModel,
      providerId: requestedProviderId,
    });
    if (!cfg) return c.json({ context: null });

    const key = JSON.stringify([workspace.userId, cfg.kind, cfg.baseUrl, cfg.model]);
    const cached = modelCache.get(key);
    if (cached && cached.until > Date.now()) return c.json({ context: cached.value });

    const result = await fetchProviderModels({ ...cfg, selectedModel: cfg.model, logger: deps.logger });
    const model = result.models.find((m) => m.id === cfg.model);
    const value = {
      model: cfg.model,
      modelLabel: `${cfg.kind}:${cfg.model}`,
      contextWindow: model?.contextWindow ?? null,
      contextBasis: model?.contextBasis ?? null,
      source: result.source,
      fetchedAt: new Date().toISOString(),
    };
    modelCache.set(key, { until: Date.now() + 300_000, value });
    return c.json({ context: value });
  });

  /** Get all providers and active provider */
  routes.get("/", async (c) => {
    const workspace = requireWorkspace(c);
    const list = await deps.providers.list(workspace.userId);
    const active = list.find((p) => p.enabled) ?? list[0] ?? null;
    return c.json({
      providers: list,
      activeProvider: active,
      // legacy compatibility
      provider: active ? {
        kind: active.kind,
        baseUrl: active.baseUrl,
        model: active.activeModel,
        hasKey: active.hasKey,
      } : null,
    });
  });

  /** Get single provider */
  routes.get("/:id", async (c) => {
    const workspace = requireWorkspace(c);
    const provider = await deps.providers.get(workspace.userId, c.req.param("id"));
    if (!provider) throw new AppError("NOT_FOUND", "Provider tidak ditemukan.", 404);
    return c.json({ provider });
  });

  /** Save / update provider */
  routes.post("/", zValidator("json", SaveSchema), async (c) => {
    const workspace = requireWorkspace(c);
    const input = c.req.valid("json");
    const saved = await deps.providers.save(workspace.userId, input);
    modelCache.clear();
    return c.json({ provider: saved });
  });

  /** Toggle on/off for a provider */
  routes.patch("/:id/toggle", zValidator("json", ToggleSchema), async (c) => {
    const workspace = requireWorkspace(c);
    const input = c.req.valid("json");
    const updated = await deps.providers.toggle(workspace.userId, c.req.param("id"), input.enabled);
    modelCache.clear();
    return c.json({ provider: updated });
  });

  /** Set active model for a provider */
  routes.patch("/:id/active-model", zValidator("json", SetActiveModelSchema), async (c) => {
    const workspace = requireWorkspace(c);
    const input = c.req.valid("json");
    const updated = await deps.providers.setActiveModel(workspace.userId, c.req.param("id"), input.model);
    modelCache.clear();
    return c.json({ provider: updated });
  });

  /** Delete specific provider */
  routes.delete("/:id", async (c) => {
    const workspace = requireWorkspace(c);
    await deps.providers.remove(workspace.userId, c.req.param("id"));
    modelCache.clear();
    return c.json({ ok: true });
  });

  /** Delete all / active provider (legacy) */
  routes.delete("/", async (c) => {
    const workspace = requireWorkspace(c);
    await deps.providers.remove(workspace.userId);
    modelCache.clear();
    return c.json({ ok: true });
  });

  /** Auto-fetch model list from the provider using transient key */
  routes.post("/models", zValidator("json", FetchModelsSchema), async (c) => {
    const workspace = requireWorkspace(c);
    const input = c.req.valid("json");
    const saved = !input.apiKey && input.providerId
      ? await deps.providers.getSavedKey(workspace.userId, input.providerId)
      : null;
    if (!input.apiKey && !saved) throw new AppError("VALIDATION_FAILED", "API key atau provider tersimpan wajib dipilih.", 422);
    if (saved && (saved.kind !== input.kind || (input.baseUrl && input.baseUrl.replace(/\/+$/, "") !== saved.baseUrl))) {
      throw new AppError("VALIDATION_FAILED", "Untuk endpoint baru, isi ulang API key sebelum mengambil model.", 422);
    }
    const result = await fetchProviderModels({
      kind: input.kind as ProviderKind,
      baseUrl: input.baseUrl ?? saved?.baseUrl,
      apiKey: input.apiKey ?? saved!.apiKey,
      logger: deps.logger,
    });
    return c.json({ models: result.models, source: result.source });
  });
}
