import type { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { AppError } from "../../lib/errors";
import type { Env } from "../../types";
import { globalCheckpoints, globalRateLimiter } from "../../agent/rate-limiter";
import { requireWorkspace } from "../../middleware/session";
import { OverrideSchema, type AiProviderRouteCtx } from "./ctx";

/**
 * Status rate limit terpusat untuk UI (#7): model aktif, pemakaian RPM/TPM
 * (estimasi lokal rolling 60 dtk — BUKAN kuota resmi), status RPD hanya bila
 * provider menyediakannya, antrean, retry berikutnya, alasan fallback,
 * plus checkpoint menunggu kuota.
 */
export function registerRateLimitRoutes(routes: Hono<Env>, ctx: AiProviderRouteCtx) {
  const { deps } = ctx;

  routes.get("/rate-limits", async (c) => {
    const workspace = requireWorkspace(c);
    const limiter = deps.limiter ?? globalRateLimiter;
    const store = deps.checkpoints ?? globalCheckpoints;
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
    const store = deps.checkpoints ?? globalCheckpoints;
    return c.json({ checkpoints: store.list().filter((cp) => !cp.userId || cp.userId === workspace.userId) });
  });

  routes.delete("/rate-limits/checkpoints/:id", async (c) => {
    const workspace = requireWorkspace(c);
    const store = deps.checkpoints ?? globalCheckpoints;
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
    const limiter = deps.limiter ?? globalRateLimiter;
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
}
