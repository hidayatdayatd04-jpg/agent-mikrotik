import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import type { Env } from "../types";
import { AppError } from "../lib/errors";
import type { ProviderSettingsService, ProviderKind } from "../agent/provider-settings";
import { fetchProviderModels } from "../agent/model-fetch";
import type { Logger } from "../lib/logger";
import { requireWorkspace } from "../middleware/session";

/**
 * AI provider settings + model auto-fetch (Multi-Provider with isolation).
 * The API key is submitted to save or transiently to fetch models — it is never
 * returned by any GET.
 */
export function createAiProviderRoutes(deps: {
  providers: ProviderSettingsService;
  logger: Logger;
  limiter?: import("../agent/rate-limiter").CentralRateLimiter;
  checkpoints?: import("../agent/rate-limiter").CheckpointStore;
}) {
  const routes = new Hono<Env>();
  const modelCache = new Map<string, { until: number; value: Record<string, unknown> }>();

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

  const SaveSchema = z.object({
    id: z.string().max(64).optional(),
    kind: z.enum(["gemini", "openrouter", "custom"]),
    name: z.string().max(128).optional(),
    baseUrl: z.string().max(512).optional(),
    apiKey: z.string().min(8).max(512).optional(),
    models: z.array(z.string().min(1).max(255)).optional(),
    activeModel: z.string().min(1).max(255).optional(),
    model: z.string().min(1).max(255).optional(), // legacy alias
    enabled: z.boolean().optional(),
  });

  const ToggleSchema = z.object({
    enabled: z.boolean(),
  });

  const SetActiveModelSchema = z.object({
    model: z.string().min(1).max(255),
  });

  const FetchModelsSchema = z.object({
    providerId: z.string().max(64).optional(),
    kind: z.enum(["gemini", "openrouter", "custom"]),
    baseUrl: z.string().max(512).optional(),
    apiKey: z.string().min(8).max(512).optional(),
  });

  const OverrideSchema = z.object({
    scope: z.enum(["provider", "model", "shared"]),
    key: z.string().min(1).max(255),
    rpm: z.number().int().min(1).max(1000).optional(),
    tpm: z.number().int().min(1000).max(10000000).optional(),
  });

  /**
   * Status rate limit terpusat untuk UI (#7): model aktif, pemakaian RPM/TPM
   * (estimasi lokal rolling 60 dtk — BUKAN kuota resmi), status RPD hanya bila
   * provider menyediakannya, antrean, retry berikutnya, alasan fallback,
   * plus checkpoint menunggu kuota. Didefinisikan SEBELUM "/:id" agar tidak
   * tertangkap param.
   */
  routes.get("/rate-limits", async (c) => {
    const workspace = requireWorkspace(c);
    const limiter = deps.limiter ?? (await import("../agent/rate-limiter")).globalRateLimiter;
    const store = deps.checkpoints ?? (await import("../agent/rate-limiter")).globalCheckpoints;
    const list = await deps.providers.list(workspace.userId);
    const active = list.find((p) => p.enabled) ?? list[0] ?? null;
    const configuredKeys = new Set<string>();
    for (const p of list) {
      for (const m of p.models) configuredKeys.add(`${p.kind}:${m}`);
      if (p.activeModel) configuredKeys.add(`${p.kind}:${p.activeModel}`);
    }
    const snapshots = limiter.snapshot([...configuredKeys]);
    // Sisipkan status RPD observasi provider (bila ada) ke snapshot limiter.
    const rpdByKey = new Map<string, { limit: number | null; remaining: number | null; resetAt: string | null }>();
    for (const p of list) {
      for (const [model, st] of Object.entries(p.modelLimits ?? {})) {
        const key = `${p.kind}:${model}`;
        const s = st as { requestsLimit?: number | null };
        void s;
        const typed = st as unknown as Record<string, unknown>;
        const dailyLimit = typeof typed.dailyLimit === "number" ? (typed.dailyLimit as number) : null;
        const dailyRemaining = typeof typed.dailyRemaining === "number" ? (typed.dailyRemaining as number) : null;
        const dailyResetAt = typeof typed.dailyResetAt === "string" ? (typed.dailyResetAt as string) : null;
        if (dailyLimit !== null || dailyRemaining !== null || dailyResetAt !== null) {
          rpdByKey.set(key, { limit: dailyLimit, remaining: dailyRemaining, resetAt: dailyResetAt });
        }
      }
    }
    const models = snapshots.map((s) => ({
      ...s,
      // RPD dari observasi provider lebih otoritatif daripada cache limiter.
      rpdStatus: rpdByKey.get(s.modelKey) ?? s.rpdStatus,
    }));
    return c.json({
      defaults: limiter.getDefaults(),
      activeModel: active ? `${active.kind}:${active.activeModel}` : null,
      activeProviderId: active?.id ?? null,
      globalQueue: limiter.getGlobalQueue(),
      models,
      checkpoints: store.list().filter((cp) => !cp.userId || cp.userId === workspace.userId),
      note: "rpmUsed/tpmUsed adalah estimasi lokal rolling 60 detik, bukan kuota resmi provider. Status RPD hanya ditampilkan bila provider menyediakannya.",
    });
  });

  routes.get("/rate-limits/checkpoints", async (c) => {
    const workspace = requireWorkspace(c);
    const store = deps.checkpoints ?? (await import("../agent/rate-limiter")).globalCheckpoints;
    return c.json({ checkpoints: store.list().filter((cp) => !cp.userId || cp.userId === workspace.userId) });
  });

  routes.delete("/rate-limits/checkpoints/:id", async (c) => {
    const workspace = requireWorkspace(c);
    const store = deps.checkpoints ?? (await import("../agent/rate-limiter")).globalCheckpoints;
    const id = c.req.param("id");
    const checkpoint = store.get(id);
    if (!checkpoint || (checkpoint.userId && checkpoint.userId !== workspace.userId)) {
      throw new AppError("NOT_FOUND", "Checkpoint tidak ditemukan.", 404);
    }
    const ok = store.remove(id);
    if (!ok) throw new AppError("NOT_FOUND", "Checkpoint tidak ditemukan.", 404);
    return c.json({ ok: true });
  });

  /** Override per-provider / per-model / shared yang lebih ketat (#4). */
  routes.patch("/rate-limits/overrides", zValidator("json", OverrideSchema), async (c) => {
    requireWorkspace(c);
    const limiter = deps.limiter ?? (await import("../agent/rate-limiter")).globalRateLimiter;
    const input = c.req.valid("json");
    if (input.rpm === undefined && input.tpm === undefined) {
      throw new AppError("VALIDATION_FAILED", "Isi rpm dan/atau tpm untuk override.", 422);
    }
    const override = { ...(input.rpm !== undefined ? { rpm: input.rpm } : {}), ...(input.tpm !== undefined ? { tpm: input.tpm } : {}) };
    if (input.scope === "provider") limiter.setProviderOverride(input.key, override);
    else if (input.scope === "model") limiter.setModelOverride(input.key, override);
    else limiter.setSharedOverride(input.key, override);
    return c.json({ ok: true, effective: limiter.getEffectiveLimits({ providerKind: input.scope === "provider" ? input.key : "custom", modelKey: input.scope === "model" ? input.key : input.key }) });
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

  return routes;
}
