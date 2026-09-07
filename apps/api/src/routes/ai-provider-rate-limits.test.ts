import { expect, test } from "bun:test";
import { Hono } from "hono";
import { createAiProviderRoutes } from "./ai-provider";
import { createProviderSettingsService } from "../agent/provider-settings";
import { CentralRateLimiter, CheckpointStore } from "../agent/rate-limiter";
import { createDb } from "../db";
import { workspaces } from "../db/schema";
import { envKeyRing } from "../lib/crypto";
import { AppError } from "../lib/errors";
import type { Env } from "../types";
import type { Logger } from "../lib/logger";

const logger: Logger = { debug() {}, info() {}, warn() {}, error() {} };

test("GET /rate-limits menampilkan default 4 RPM/150k TPM, antrean, RPD, fallback, checkpoint", async () => {
  const db = createDb(":memory:");
  const [user] = await db.insert(workspaces).values({ name: "rl-status" }).returning();
  const providers = createProviderSettingsService({
    db,
    logger,
    keyRing: envKeyRing({ 1: Buffer.alloc(32, 9).toString("base64") }, 1),
  });
  await providers.save(user!.id, { id: "gemini", kind: "gemini", models: ["gemini-2.0-flash"], activeModel: "gemini-2.0-flash", apiKey: "gemini-secret-12345" });
  await providers.save(user!.id, { id: "openrouter", kind: "openrouter", models: ["openai/gpt-4o-mini"], activeModel: "openai/gpt-4o-mini", apiKey: "or-secret-12345" });

  const limiter = new CentralRateLimiter();
  const checkpoints = new CheckpointStore();
  // Simulasi pemakaian + blokir harian + fallback + checkpoint.
  const t = await limiter.acquire({ modelKey: "gemini:gemini-2.0-flash", providerKind: "gemini", estimatedTokens: 1000 });
  t.complete(1000);
  limiter.notifyDailyQuotaExhausted({ modelKey: "openrouter:openai/gpt-4o-mini", resetAtMs: Date.now() + 60_000, reason: "RPD habis (test)" });
  checkpoints.save({
    runId: "run-1",
    conversationId: null,
    userId: user!.id,
    userText: "cek",
    primaryModelKey: "openrouter:openai/gpt-4o-mini",
    attemptedModels: ["openrouter:openai/gpt-4o-mini"],
    reason: "RPD habis",
    fallbackReason: "fallback dicoba",
    policyMode: "write",
    nextRetryAt: null,
  });

  const app = new Hono<Env>();
  app.use("*", async (c, next) => { c.set("workspace", { userId: user!.id }); await next(); });
  app.route("/", createAiProviderRoutes({ providers, logger, limiter, checkpoints }));
  app.onError((err, c) => c.json({ error: { code: (err as AppError).code ?? "INTERNAL_ERROR", message: (err as Error).message } }, 500));

  const res = await app.request("/rate-limits");
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    defaults: { rpm: number; tpm: number };
    activeModel: string | null;
    globalQueue: number;
    models: { modelKey: string; rpmUsed: number; rpmLimit: number; tpmUsed: number; tpmLimit: number; isDailyQuotaExhausted: boolean; fallbackReason: string | null }[];
    checkpoints: { policyMode?: string }[];
    note: string;
  };
  expect(body.defaults).toEqual({ rpm: 4, tpm: 150_000 });
  expect(body.activeModel).toContain("gemini");
  const gemini = body.models.find((m) => m.modelKey === "gemini:gemini-2.0-flash")!;
  expect(gemini.rpmUsed).toBe(1);
  expect(gemini.rpmLimit).toBe(4);
  expect(gemini.tpmLimit).toBe(150_000);
  const or = body.models.find((m) => m.modelKey === "openrouter:openai/gpt-4o-mini")!;
  expect(or.isDailyQuotaExhausted).toBe(true);
  expect(body.checkpoints).toHaveLength(1);
  expect(body.note).toMatch(/estimasi lokal/i);
});

test("PATCH /rate-limits/overrides menerapkan batas lebih ketat per model", async () => {
  const db = createDb(":memory:");
  const [user] = await db.insert(workspaces).values({ name: "rl-override" }).returning();
  const providers = createProviderSettingsService({
    db,
    logger,
    keyRing: envKeyRing({ 1: Buffer.alloc(32, 10).toString("base64") }, 1),
  });
  const limiter = new CentralRateLimiter();
  const app = new Hono<Env>();
  app.use("*", async (c, next) => { c.set("workspace", { userId: user!.id }); await next(); });
  app.route("/", createAiProviderRoutes({ providers, logger, limiter }));
  app.onError((err, c) => {
    const status = err instanceof AppError ? err.status : 500;
    return c.json({ error: { code: err instanceof AppError ? err.code : "INTERNAL_ERROR", message: (err as Error).message } }, status as 200);
  });

  const res = await app.request("/rate-limits/overrides", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scope: "model", key: "gemini:gemini-2.0-flash", rpm: 2 }),
  });
  expect(res.status).toBe(200);
  expect(limiter.getEffectiveLimits({ providerKind: "gemini", modelKey: "gemini:gemini-2.0-flash" }).rpm).toBe(2);
  // Model lain tetap default global.
  expect(limiter.getEffectiveLimits({ providerKind: "custom", modelKey: "custom:x" }).rpm).toBe(4);
});
