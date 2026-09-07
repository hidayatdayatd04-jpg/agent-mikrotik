import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { createDb, type Database } from "../db";
import { envKeyRing, type KeyRing } from "../lib/crypto";
import { createProviderSettingsService, defaultBaseUrl } from "./provider-settings";
import { workspaces } from "../db/schema";
import { eq } from "drizzle-orm";

/** Real SQLite queries with an isolated in-memory database. */
const dbUrl = ":memory:";

let db: Database;
let keyRing: KeyRing;
let service: ReturnType<typeof createProviderSettingsService>;
let connected = false;

const silentLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => silentLogger,
} as unknown as Parameters<typeof createProviderSettingsService>[0]["logger"];

const TEST_EMAIL = "provider-settings-test@example.com";
let userId = "";

const TEST_KEY = Buffer.from("unit-test-keyring-32-bytes-pad!!", "utf8").subarray(0, 32).toString("base64");

beforeAll(async () => {
  try {
    db = createDb(dbUrl);
    await db.run("select 1");
  } catch {
    throw new Error("SQLite test setup failed");
  }
  connected = true;
  keyRing = envKeyRing({ 1: TEST_KEY }, 1);
  service = createProviderSettingsService({ db, keyRing, logger: silentLogger });
  await db.delete(workspaces).where(eq(workspaces.name, TEST_EMAIL));
  const [u] = await db.insert(workspaces).values({ name: "provider-test" }).returning();
  userId = u!.id;
});

afterAll(async () => {
  if (!connected) return;
  await db.delete(workspaces).where(eq(workspaces.name, TEST_EMAIL));
});

describe("provider settings service (multi-provider & multiple models)", () => {
  test("defaultBaseUrl maps kinds to canonical OpenAI-compatible endpoints", () => {
    expect(defaultBaseUrl("gemini")).toBe("https://generativelanguage.googleapis.com/v1beta/openai/v1");
    expect(defaultBaseUrl("openrouter")).toBe("https://openrouter.ai/api/v1");
    expect(defaultBaseUrl("custom")).toBe("");
  });

  test("saving multiple providers maintains independent keys without overwriting", async () => {
    if (!connected) return;
    // 1. Save Gemini with multiple models
    await service.save(userId, {
      kind: "gemini",
      models: ["gemini-2.0-flash", "gemini-2.5-flash", "gemini-1.5-pro"],
      activeModel: "gemini-2.0-flash",
      apiKey: "gemini-secret-key-12345",
    });

    // 2. Save OpenRouter with multiple models
    await service.save(userId, {
      kind: "openrouter",
      models: ["anthropic/claude-3.5-sonnet", "deepseek/deepseek-chat"],
      activeModel: "anthropic/claude-3.5-sonnet",
      apiKey: "openrouter-secret-key-67890",
    });

    // 3. Verify both providers exist independently in ai_providers
    const providers = await service.list(userId);
    expect(providers.length).toBe(2);

    const gemini = providers.find((p) => p.kind === "gemini");
    const openrouter = providers.find((p) => p.kind === "openrouter");

    expect(gemini).toBeDefined();
    expect(gemini?.models).toEqual(["gemini-2.0-flash", "gemini-2.5-flash", "gemini-1.5-pro"]);
    expect(gemini?.activeModel).toBe("gemini-2.0-flash");
    expect(gemini?.hasKey).toBe(true);

    expect(openrouter).toBeDefined();
    expect(openrouter?.models).toEqual(["anthropic/claude-3.5-sonnet", "deepseek/deepseek-chat"]);
    expect(openrouter?.activeModel).toBe("anthropic/claude-3.5-sonnet");
    expect(openrouter?.hasKey).toBe(true);

    // 4. Verify resolved keys are distinct and uncorrupted!
    const geminiConfig = await service.resolveForRun(userId, { providerId: "gemini" });
    expect(geminiConfig?.apiKey).toBe("gemini-secret-key-12345");

    const openrouterConfig = await service.resolveForRun(userId, { providerId: "openrouter" });
    expect(openrouterConfig?.apiKey).toBe("openrouter-secret-key-67890");
  });

  test("resolveForRun finds correct provider based on requested model", async () => {
    if (!connected) return;
    // Requesting a model in OpenRouter
    const claudeRun = await service.resolveForRun(userId, { model: "anthropic/claude-3.5-sonnet" });
    expect(claudeRun?.kind).toBe("openrouter");
    expect(claudeRun?.model).toBe("anthropic/claude-3.5-sonnet");
    expect(claudeRun?.apiKey).toBe("openrouter-secret-key-67890");

    // Requesting a model in Gemini
    const geminiRun = await service.resolveForRun(userId, { model: "gemini-2.5-flash" });
    expect(geminiRun?.kind).toBe("gemini");
    expect(geminiRun?.model).toBe("gemini-2.5-flash");
    expect(geminiRun?.apiKey).toBe("gemini-secret-key-12345");
  });

  test("toggle on/off disables provider from run resolution", async () => {
    if (!connected) return;
    // Toggle OpenRouter OFF
    await service.toggle(userId, "openrouter", false);

    const openrouter = await service.get(userId, "openrouter");
    expect(openrouter?.enabled).toBe(false);

    // Now requesting claude model will not match disabled openrouter
    await expect(service.resolveForRun(userId, { model: "anthropic/claude-3.5-sonnet" })).rejects.toMatchObject({ code: "VALIDATION_FAILED" });

    // Toggle back ON
    await service.toggle(userId, "openrouter", true);
    const reEnabled = await service.resolveForRun(userId, { model: "anthropic/claude-3.5-sonnet" });
    expect(reEnabled?.kind).toBe("openrouter");
  });

  test("setActiveModel updates provider active model", async () => {
    if (!connected) return;
    await service.setActiveModel(userId, "gemini", "gemini-2.5-flash");
    const gemini = await service.get(userId, "gemini");
    expect(gemini?.activeModel).toBe("gemini-2.5-flash");
  });

  test("getPublic never returns key material — only hasKey", async () => {
    if (!connected) return;
    const pub = await service.getPublic(userId);
    expect(pub).not.toBeNull();
    expect((pub as Record<string, unknown>).apiKey).toBeUndefined();
    expect((pub as Record<string, unknown>).apiKeyCiphertext).toBeUndefined();
    expect(pub?.hasKey).toBe(true);
  });

  test("remove deletes specific provider", async () => {
    if (!connected) return;
    await service.remove(userId, "openrouter");
    const openrouter = await service.get(userId, "openrouter");
    expect(openrouter).toBeNull();

    // Gemini still survives!
    const gemini = await service.get(userId, "gemini");
    expect(gemini).not.toBeNull();
  });
});

test("exact provider/model selection and observed limits remain isolated across switches and key replacement", async () => {
  const isolatedDb = createDb(":memory:");
  const [workspace] = await isolatedDb.insert(workspaces).values({ name: "isolated-provider" }).returning();
  const svc = createProviderSettingsService({ db: isolatedDb, keyRing, logger: silentLogger });
  const uid = workspace!.id;
  for (const id of ["a", "b"]) await svc.save(uid, { id, kind: "custom", baseUrl: `https://${id}.example/v1`, models: ["shared", "other"], activeModel: "shared", apiKey: `${id}-secret-key` });
  const a = (await svc.resolveForRun(uid, { providerId: "a", model: "shared" }))!;
  const b = (await svc.resolveForRun(uid, { providerId: "b", model: "shared" }))!;
  expect(a.apiKey).toBe("a-secret-key");
  expect(b.apiKey).toBe("b-secret-key");
  expect(b.baseUrl).toBe("https://b.example/v1");
  const limited = { status: "limited" as const, observedAt: new Date().toISOString(), retryAt: null, requestsLimit: 20, requestsRemaining: 0, tokensLimit: null, tokensRemaining: null };
  await a.onObservation!(limited);
  expect((await svc.get(uid, "a"))?.modelLimits?.shared?.status).toBe("limited");
  expect((await svc.get(uid, "a"))?.modelLimits?.other).toBeUndefined();
  expect((await svc.get(uid, "b"))?.modelLimits).toEqual({});
  await svc.setActiveModel(uid, "a", "other");
  expect((await svc.resolveForRun(uid, { providerId: "a" }))?.model).toBe("other");
  await expect(svc.resolveForRun(uid, { providerId: "missing", model: "shared" })).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  await expect(svc.resolveForRun(uid, { providerId: "b", model: "unknown" })).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  await svc.save(uid, { id: "a", kind: "custom", baseUrl: a.baseUrl, models: ["shared", "other"], apiKey: "replacement-key" });
  await a.onObservation!(limited); // in-flight response for the old key must be ignored
  expect((await svc.get(uid, "a"))?.modelLimits).toEqual({});
  const reloaded = createProviderSettingsService({ db: isolatedDb, keyRing, logger: silentLogger });
  await b.onObservation!(limited);
  expect((await reloaded.get(uid, "b"))?.modelLimits?.shared?.status).toBe("limited");
  await svc.remove(uid, "a");
  await svc.remove(uid, "b");
  expect(await svc.list(uid)).toEqual([]);
});
