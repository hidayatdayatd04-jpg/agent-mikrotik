import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { createDb, type Database } from "../db";
import { envKeyRing, type KeyRing } from "../lib/crypto";
import { createProviderSettingsService, defaultBaseUrl } from "./provider-settings";
import { aiProviderSettings, users } from "../db/schema";
import { eq } from "drizzle-orm";
import { AppError } from "../lib/errors";
import type { ApiErrorCode } from "@shared/index";

/**
 * Integration test against local Docker Postgres (DATABASE_URL env).
 * Skipped automatically when no local database is reachable — same pattern
 * as services/auth.integration.test.ts.
 */
const dbUrl = process.env.DATABASE_URL ?? "postgres://dev:dev@localhost:5432/agent_mikrotik";

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
const OTHER_KEY = Buffer.from("other-test-keyring-32-bytes!!!", "utf8").subarray(0, 32).toString("base64");

beforeAll(async () => {
  try {
    db = createDb(dbUrl);
    await db.execute("select 1");
  } catch {
    console.log("no local postgres; skipping provider-settings integration tests");
    return;
  }
  connected = true;
  keyRing = envKeyRing({ 1: TEST_KEY }, 1);
  service = createProviderSettingsService({ db, keyRing, logger: silentLogger });
  await db.delete(users).where(eq(users.email, TEST_EMAIL));
  const [u] = await db.insert(users).values({ email: TEST_EMAIL, name: "provider-test" }).returning();
  userId = u!.id;
});

afterAll(async () => {
  if (!connected) return;
  await db.delete(users).where(eq(users.email, TEST_EMAIL));
});

describe("provider settings service (integration, local postgres)", () => {
  test("defaultBaseUrl maps kinds to canonical OpenAI-compatible endpoints", () => {
    expect(defaultBaseUrl("gemini")).toBe("https://generativelanguage.googleapis.com/v1beta/openai/v1");
    expect(defaultBaseUrl("openrouter")).toBe("https://openrouter.ai/api/v1");
    expect(defaultBaseUrl("custom")).toBe("");
  });

  test("save → getWithKey round-trips the sealed API key; ciphertext differs from plaintext", async () => {
    if (!connected) return;
    const saved = await service.save(userId, {
      kind: "gemini",
      baseUrl: "",
      model: "gemini-2.0-flash",
      apiKey: "test-key-abcdef",
    });
    expect(saved.baseUrl).toBe(defaultBaseUrl("gemini"));
    const withKey = await service.getWithKey(userId);
    expect(withKey?.apiKey).toBe("test-key-abcdef");
    expect(withKey?.model).toBe("gemini-2.0-flash");
    const [row] = await db.select().from(aiProviderSettings).where(eq(aiProviderSettings.userId, userId));
    expect(row?.apiKeyCiphertext).not.toContain("test-key-abcdef");
  });

  test("getPublic never returns key material — only hasKey", async () => {
    if (!connected) return;
    const pub = await service.getPublic(userId);
    expect(pub).not.toBeNull();
    expect((pub as Record<string, unknown>).apiKey).toBeUndefined();
    expect((pub as Record<string, unknown>).apiKeyCiphertext).toBeUndefined();
    expect(pub).toEqual({ kind: "gemini", baseUrl: defaultBaseUrl("gemini"), model: "gemini-2.0-flash", hasKey: true });
  });

  test("upsert replaces settings (one row per user)", async () => {
    if (!connected) return;
    await service.save(userId, { kind: "openrouter", baseUrl: "https://openrouter.ai/api/v1/", model: "qwen/qwen-2.5", apiKey: "sk-or-v1-xyz" });
    const rows = await db.select().from(aiProviderSettings).where(eq(aiProviderSettings.userId, userId));
    expect(rows.length).toBe(1);
    expect(rows[0]?.kind).toBe("openrouter");
    expect(rows[0]?.baseUrl).toBe("https://openrouter.ai/api/v1"); // trailing slash stripped
    const withKey = await service.getWithKey(userId);
    expect(withKey?.apiKey).toBe("sk-or-v1-xyz");
  });

  test("getWithKey under a different keyRing fails decrypt → INTERNAL_ERROR", async () => {
    if (!connected) return;
    const otherRing = envKeyRing({ 1: OTHER_KEY }, 1);
    const otherService = createProviderSettingsService({ db, keyRing: otherRing, logger: silentLogger });
    try {
      await otherService.getWithKey(userId);
      throw new Error("should have thrown");
    } catch (err) {
      expect(err instanceof AppError).toBe(true);
      expect((err as AppError).code).toBe("INTERNAL_ERROR");
    }
  });

  test("invalid inputs are rejected: bad kind, bad url, short key, bad model", async () => {
    if (!connected) return;
    const cases: { input: Parameters<typeof service.save>[1]; code: ApiErrorCode }[] = [
      { input: { kind: "anthropic" as never, model: "m", apiKey: "long-enough-key" }, code: "VALIDATION_FAILED" },
      { input: { kind: "custom", baseUrl: "ftp://nope", model: "m", apiKey: "long-enough-key" }, code: "VALIDATION_FAILED" },
      { input: { kind: "custom", baseUrl: "http://x", model: "m", apiKey: "short" }, code: "VALIDATION_FAILED" },
      { input: { kind: "custom", baseUrl: "http://x", model: "bad model name!", apiKey: "long-enough-key" }, code: "VALIDATION_FAILED" },
    ];
    for (const c of cases) {
      try {
        await service.save(userId, c.input);
        throw new Error(`expected VALIDATION_FAILED for ${JSON.stringify(c.input).slice(0, 60)}`);
      } catch (err) {
        expect(err instanceof AppError).toBe(true);
        expect((err as AppError).code).toBe(c.code);
      }
    }
  });

  test("remove deletes the row; getWithKey returns null afterwards", async () => {
    if (!connected) return;
    await service.remove(userId);
    expect(await service.getWithKey(userId)).toBeNull();
    expect(await service.getPublic(userId)).toBeNull();
  });
});
