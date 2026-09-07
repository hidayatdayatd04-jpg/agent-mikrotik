import { describe, expect, test } from "bun:test";
import {
  CentralRateLimiter,
  CheckpointStore,
  DEFAULT_GLOBAL_RPM,
  DEFAULT_GLOBAL_TPM,
  classifyQuotaError,
  computeBackoffWithJitter,
  estimateRequestTokens,
  modelKeyFor,
  nextMidnightUtcMs,
  parseRetryAfterMs,
  sharedKeyForApiKey,
} from "./rate-limiter";
import { createFallbackChatClient, pickFallbackCandidate, type FallbackCandidate } from "./model-fallback";
import { isDailyQuotaError, observeProviderResponse } from "./provider-limits";
import type { ChatClient } from "./chat-client";

function makeLimiter(opts: Partial<ConstructorParameters<typeof CentralRateLimiter>[0]> = {}) {
  let now = 1_000_000;
  const limiter = new CentralRateLimiter({
    nowFn: () => now,
    sleepFn: async (ms) => {
      now += ms;
    },
    jitterFn: () => 0,
    ...opts,
  });
  return { limiter, advance: (ms: number) => { now += ms; }, now: () => now };
}

describe("central rate limiter — default global 4 RPM / 150.000 TPM", () => {
  test("defaults sama untuk seluruh model/provider (gemini, openrouter, custom)", () => {
    expect(DEFAULT_GLOBAL_RPM).toBe(4);
    expect(DEFAULT_GLOBAL_TPM).toBe(150_000);
    const { limiter } = makeLimiter();
    for (const kind of ["gemini", "openrouter", "custom"]) {
      const eff = limiter.getEffectiveLimits({ providerKind: kind, modelKey: modelKeyFor(kind, "any-model") });
      expect(eff).toEqual({ rpm: 4, tpm: 150_000 });
    }
  });

  test("override lebih ketat menurunkan batas; override longgar tidak mengabaikan global", () => {
    const { limiter } = makeLimiter();
    limiter.setProviderOverride("gemini", { rpm: 2 });
    limiter.setModelOverride("openrouter:my-model", { tpm: 60_000 });
    expect(limiter.getEffectiveLimits({ providerKind: "gemini", modelKey: "gemini:m" })).toMatchObject({ rpm: 2 });
    expect(limiter.getEffectiveLimits({ providerKind: "openrouter", modelKey: "openrouter:my-model" })).toMatchObject({ tpm: 60_000 });
    // Override longgar (10 RPM) tetap dibatasi global 4 RPM (min).
    limiter.setProviderOverride("custom", { rpm: 10, tpm: 500_000 });
    expect(limiter.getEffectiveLimits({ providerKind: "custom", modelKey: "custom:m" })).toEqual({ rpm: 4, tpm: 150_000 });
  });

  test("batas 4 RPM: request ke-5 dalam 60 dtk ditolak, pulih setelah rolling window", async () => {
    const { limiter, advance } = makeLimiter();
    const key = "gemini:gemini-2.0-flash";
    for (let i = 0; i < 4; i++) {
      const t = await limiter.acquire({ modelKey: key, providerKind: "gemini", estimatedTokens: 100 });
      t.complete(100);
    }
    await expect(
      limiter.acquire({ modelKey: key, providerKind: "gemini", estimatedTokens: 100, timeoutMs: 50 }),
    ).rejects.toMatchObject({ code: "RATE_LIMITED" });
    // Rolling window: majukan 61 dtk → kapasitas kembali.
    advance(61_000);
    const t = await limiter.acquire({ modelKey: key, providerKind: "gemini", estimatedTokens: 100 });
    t.complete(100);
    const usage = limiter.usageOf(key);
    expect(usage.rpmUsed).toBe(1);
  });

  test("batas 150.000 TPM: estimasi sebelum request + rekonsiliasi aktual", async () => {
    const { limiter } = makeLimiter();
    const key = "openrouter:anthropic/claude-3.5-sonnet";
    const t1 = await limiter.acquire({ modelKey: key, providerKind: "openrouter", estimatedTokens: 100_000 });
    t1.complete(100_000);
    // 100rb + 60rb > 150rb → tolak dengan timeout pendek.
    await expect(
      limiter.acquire({ modelKey: key, providerKind: "openrouter", estimatedTokens: 60_000, timeoutMs: 50 }),
    ).rejects.toMatchObject({ code: "RATE_LIMITED" });
    // Estimasi 10rb direkonsiliasi menjadi aktual 2rb → hemat 8rb.
    const t2 = await limiter.acquire({ modelKey: "custom:m2", providerKind: "custom", estimatedTokens: 10_000 });
    t2.complete(2_000);
    expect(limiter.usageOf("custom:m2").tpmUsed).toBe(2_000);
  });

  test("rolling window akurat: entry lama kedaluwarsa tepat 60 dtk", async () => {
    const { limiter, advance } = makeLimiter();
    const key = "custom:rolling";
    const t = await limiter.acquire({ modelKey: key, providerKind: "custom", estimatedTokens: 50_000 });
    t.complete(50_000);
    expect(limiter.usageOf(key).tpmUsed).toBe(50_000);
    advance(59_999);
    expect(limiter.usageOf(key).tpmUsed).toBe(50_000);
    advance(2);
    expect(limiter.usageOf(key).tpmUsed).toBe(0);
  });

  test("shared quota: model berbagi API key dijumlahkan pada bucket bersama", async () => {
    const { limiter } = makeLimiter();
    const shared = sharedKeyForApiKey("secret-sama");
    const a = "gemini:model-a";
    const b = "gemini:model-b";
    for (let i = 0; i < 4; i++) {
      const t = await limiter.acquire({ modelKey: a, providerKind: "gemini", sharedKey: shared, estimatedTokens: 10 });
      t.complete(10);
    }
    // Bucket model B masih kosong, tetapi bucket shared penuh → tolak.
    await expect(
      limiter.acquire({ modelKey: b, providerKind: "gemini", sharedKey: shared, estimatedTokens: 10, timeoutMs: 50 }),
    ).rejects.toMatchObject({ code: "RATE_LIMITED" });
    // Key berbeda tidak terpengaruh.
    const t = await limiter.acquire({ modelKey: b, providerKind: "gemini", sharedKey: sharedKeyForApiKey("secret-lain"), estimatedTokens: 10 });
    t.complete(10);
  });

  test("error 429: Retry-After dihormati + backoff dengan jitter terbatas", async () => {
    const { limiter, now } = makeLimiter();
    const key = "openrouter:limited";
    limiter.notifyRateLimited({ modelKey: key, retryAtMs: now() + 5_000, reason: "429 test" });
    const blocked = limiter.isBlocked(key);
    expect(blocked.blocked).toBe(true);
    expect(Date.parse(blocked.retryAt!)).toBeGreaterThan(now());
    await expect(limiter.acquire({ modelKey: key, providerKind: "openrouter", estimatedTokens: 10, timeoutMs: 50 })).rejects.toMatchObject({
      code: "RATE_LIMITED",
    });
    expect(parseRetryAfterMs("12s", now())).toBe(12_000);
    expect(parseRetryAfterMs("2", now())).toBe(2_000);
    const b1 = computeBackoffWithJitter(0, 1000, 60_000, 0);
    const b2 = computeBackoffWithJitter(1, 1000, 60_000, 0);
    expect(b2).toBeGreaterThan(b1);
    expect(computeBackoffWithJitter(10, 1000, 5_000, 0)).toBeLessThanOrEqual(5_000);
  });

  test("kuota harian habis: tidak ada RPD buatan; blokir sampai reset provider", () => {
    expect(isDailyQuotaError(429, "GenerateRequestsPerDay quota exceeded. Please retry in 30s")).toBe(true);
    expect(isDailyQuotaError(429, "Rate limit exceeded, try again")).toBe(false);
    expect(classifyQuotaError(429, "daily limit reached").isDaily).toBe(true);
    const { limiter, now } = makeLimiter();
    const key = "gemini:flash";
    limiter.notifyDailyQuotaExhausted({ modelKey: key, resetAtMs: now() + 3_600_000, reason: "RPD habis" });
    const snap = limiter.snapshot([key])[0]!;
    expect(snap.isDailyQuotaExhausted).toBe(true);
    expect(snap.fallbackReason).toContain("Kuota harian");
    // Default tanpa resetAt → tengah malam UTC berikutnya.
    const { limiter: l2 } = makeLimiter();
    l2.notifyDailyQuotaExhausted({ modelKey: key, reason: "habis" });
    expect(l2.isBlocked(key).retryAt).toBe(new Date(nextMidnightUtcMs(1_000_000)).toISOString());
  });

  test("observasi provider: RPD hanya bila header tersedia, bukan estimasi lokal", () => {
    const empty = observeProviderResponse(200, new Headers());
    expect(empty.dailyLimit).toBeNull();
    expect(empty.dailyRemaining).toBeNull();
    const withDay = observeProviderResponse(
      200,
      new Headers({ "x-ratelimit-limit-day": "1000", "x-ratelimit-remaining-day": "42" }),
    );
    expect(withDay.dailyLimit).toBe(1000);
    expect(withDay.dailyRemaining).toBe(42);
  });

  test("estimasi token input+output sebelum request", () => {
    const est = estimateRequestTokens({
      messages: [{ content: "halo" }, { content: "x".repeat(3500) }],
      tools: [{ name: "t" }],
      maxTokens: 500,
    });
    // input ~3504 char /3.5 ≈ 1002 + overhead, + 500 output reserve
    expect(est).toBeGreaterThan(1400);
    expect(est).toBeLessThan(3000);
  });
});

describe("fallback + checkpoint (read-only safe)", () => {
  const primary: FallbackCandidate = { providerId: "gemini", providerKind: "gemini", model: "flash", enabled: true, apiKey: "k1" };
  const fallback: FallbackCandidate = { providerId: "openrouter", providerKind: "openrouter", model: "backup", enabled: true, apiKey: "k2" };

  test("fallback ke model cadangan yang kompatibel saat primer dibatasi", () => {
    const { limiter, now } = makeLimiter();
    limiter.notifyRateLimited({ modelKey: "gemini:flash", retryAtMs: now() + 60_000, reason: "429" });
    const picked = pickFallbackCandidate("gemini:flash", [primary, fallback], limiter);
    expect(picked?.model).toBe("backup");
    // Bila cadangan juga diblokir → null.
    limiter.notifyRateLimited({ modelKey: "openrouter:backup", retryAtMs: now() + 60_000, reason: "429" });
    expect(pickFallbackCandidate("gemini:flash", [primary, fallback], limiter)).toBeNull();
  });

  test("fallback client: stream primer gagal 429 lalu sukses di cadangan", async () => {
    const { limiter } = makeLimiter();
    const failing: ChatClient = {
      modelLabel: "gemini:flash",
      async *stream() {
        const err = new Error("Rate limit exceeded (429)") as Error & { status: number };
        err.status = 429;
        throw err;
      },
    };
    const succeeding: ChatClient = {
      modelLabel: "openrouter:backup",
      async *stream() {
        yield { type: "text", text: "ok dari cadangan" };
        yield { type: "done", finishReason: "stop" };
      },
    };
    const client = createFallbackChatClient(primary, [primary, fallback], (c) => (c.model === "flash" ? failing : succeeding), {
      limiter,
    });
    const events = [];
    for await (const e of client.stream({ messages: [{ role: "user", content: "halo" }], tools: [], maxTokens: 10 })) events.push(e);
    expect(events.map((e) => e.type)).toContain("text");
    expect(client.getFallbackReason()).toMatch(/Fallback/);
  });

  test("semua provider habis → checkpoint menunggu kuota, tanpa crash, tetap read-only", async () => {
    const { limiter, now } = makeLimiter();
    const store = new CheckpointStore();
    limiter.notifyDailyQuotaExhausted({ modelKey: "gemini:flash", resetAtMs: now() + 3_600_000, reason: "RPD habis" });
    limiter.notifyDailyQuotaExhausted({ modelKey: "openrouter:backup", resetAtMs: now() + 3_600_000, reason: "RPD habis" });
    const alwaysFail: ChatClient = {
      modelLabel: "x",
      async *stream() {
        throw new Error("Rate limit exceeded (429 daily quota per day)");
      },
    };
    const client = createFallbackChatClient(primary, [primary, fallback], () => alwaysFail, {
      limiter,
      checkpoints: store,
      runContext: { runId: "run-1", conversationId: "conv-1", userId: "u-1", userText: "cek hotspot", policyMode: "write" },
    });
    await expect(
      (async () => {
        for await (const _ of client.stream({ messages: [{ role: "user", content: "halo" }], tools: [], maxTokens: 10 })) { /* drain */ }
      })(),
    ).rejects.toThrow(/checkpoint/);
    const cps = store.list();
    expect(cps).toHaveLength(1);
    // Pemulihan TIDAK BOLEH mengaktifkan write tools.
    expect(cps[0]!.policyMode).toBe("read-only");
    expect(cps[0]!.status).toBe("waiting_quota");
    expect(cps[0]!.attemptedModels).toContain("gemini:flash");
  });

  test("retry/fallback/pemulihan tidak mengubah mode policy menjadi write", () => {
    const store = new CheckpointStore();
    const cp = store.save({
      runId: "r",
      conversationId: "c",
      userId: "u",
      userText: "tambah user hotspot",
      primaryModelKey: "gemini:flash",
      attemptedModels: ["gemini:flash"],
      reason: "429",
      fallbackReason: null,
      policyMode: "write",
      nextRetryAt: null,
    });
    // Paksa read-only walau input write.
    expect(cp.policyMode).toBe("read-only");
  });

  test("sharedKey fingerprint stabil per API key", () => {
    expect(sharedKeyForApiKey("abc")).toBe(sharedKeyForApiKey("abc"));
    expect(sharedKeyForApiKey("abc")).not.toBe(sharedKeyForApiKey("abd"));
  });
});
