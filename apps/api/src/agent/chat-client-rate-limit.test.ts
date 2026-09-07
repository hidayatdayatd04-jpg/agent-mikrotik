import { expect, test } from "bun:test";
import { createOpenAiCompatibleClient } from "./chat-client";
import { CentralRateLimiter } from "./rate-limiter";
import type { Logger } from "../lib/logger";

const silentLogger = { warn: () => {}, info: () => {}, error: () => {}, debug: () => {} } as unknown as Logger;

function sseResponse(text: string, usage?: { prompt_tokens: number; completion_tokens: number }) {
  const chunks: string[] = [`data: {"choices":[{"delta":{"content":${JSON.stringify(text)}},"finish_reason":"stop"}]}\n\n`];
  if (usage) chunks.push(`data: {"choices":[],"usage":${JSON.stringify(usage)}}\n\n`);
  chunks.push("data: [DONE]\n\n");
  return new Response(chunks.join(""), { headers: { "Content-Type": "text/event-stream" } });
}

test("chat client melewati limiter: estimasi → aktual, TPM direkonsiliasi", async () => {
  const limiter = new CentralRateLimiter({ maxRetries: 0 });
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: () => sseResponse("Halo!", { prompt_tokens: 100, completion_tokens: 20 }),
  });
  try {
    const client = createOpenAiCompatibleClient(
      { kind: "custom", baseUrl: `http://127.0.0.1:${server.port}/v1`, model: "m-test", apiKey: "k-test-key-123" },
      silentLogger,
      { limiter },
    );
    const events = [];
    for await (const e of client.stream({ messages: [{ role: "user", content: "halo" }], tools: [], maxTokens: 50 })) events.push(e);
    expect(events.some((e) => e.type === "usage")).toBe(true);
    const usage = limiter.usageOf("custom:m-test");
    // Aktual 120, bukan estimasi (estimasi ≈ 500+). Rekonsiliasi terbukti.
    expect(usage.tpmUsed).toBe(120);
    expect(usage.rpmUsed).toBe(1);
  } finally {
    server.stop(true);
  }
});

test("chat client: 429 rate-limit biasa di-retry terbatas dengan backoff lalu sukses", async () => {
  const limiter = new CentralRateLimiter({ jitterFn: () => 0 });
  let hits = 0;
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: () => {
      hits += 1;
      if (hits === 1) {
        return new Response(JSON.stringify({ error: { message: "Rate limit exceeded, try again", code: 429 } }), {
          status: 429,
          headers: { "Content-Type": "application/json", "retry-after": "0" },
        });
      }
      return sseResponse("Sukses setelah retry!");
    },
  });
  try {
    const client = createOpenAiCompatibleClient(
      { kind: "openrouter", baseUrl: `http://127.0.0.1:${server.port}/v1`, model: "retry-model", apiKey: "retry-key-12345" },
      silentLogger,
      { limiter, maxRetries: 3 },
    );
    const texts: string[] = [];
    for await (const e of client.stream({ messages: [{ role: "user", content: "halo" }], tools: [], maxTokens: 20 })) {
      if (e.type === "text" && e.text) texts.push(e.text);
    }
    expect(texts.join("")).toContain("Sukses");
    expect(hits).toBe(2);
  } finally {
    server.stop(true);
  }
});

test("chat client: kuota harian habis tidak di-retry berulang; model diblokir sampai reset", async () => {
  const limiter = new CentralRateLimiter({ maxRetries: 3, jitterFn: () => 0 });
  let hits = 0;
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: () => {
      hits += 1;
      return new Response(
        JSON.stringify({ error: { message: "GenerateRequestsPerDay quota exceeded. Please retry in 5s", code: 429 } }),
        { status: 429, headers: { "Content-Type": "application/json" } },
      );
    },
  });
  try {
    const client = createOpenAiCompatibleClient(
      { kind: "gemini", baseUrl: `http://127.0.0.1:${server.port}/v1`, model: "daily-model", apiKey: "daily-key-12345" },
      silentLogger,
      { limiter },
    );
    await expect(
      (async () => {
        for await (const _ of client.stream({ messages: [{ role: "user", content: "halo" }], tools: [], maxTokens: 20 })) { /* drain */ }
      })(),
    ).rejects.toThrow(/Kuota harian|Rate limit/);
    // Tidak ada retry tak berbatas: hanya 1 hit.
    expect(hits).toBe(1);
    const blocked = limiter.isBlocked("gemini:daily-model");
    expect(blocked.blocked).toBe(true);
    expect(blocked.isDaily).toBe(true);
  } finally {
    server.stop(true);
  }
});
