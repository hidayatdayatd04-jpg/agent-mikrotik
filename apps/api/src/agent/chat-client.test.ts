import { test, expect } from "bun:test";
import { createMockClient, createOpenAiCompatibleClient } from "./chat-client";
import type { Logger } from "../lib/logger";
import type { ModelLimitStatus } from "@shared/index";

test("stream drains usage after finish_reason and emits done last", async () => {
  const chunks = [
    { choices: [{ delta: { content: "Jawaban." }, finish_reason: null }] },
    { choices: [{ delta: {}, finish_reason: "stop" }] },
    { choices: [], usage: { prompt_tokens: 12345, completion_tokens: 87 } },
  ];
  const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response(chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n", { headers: { "Content-Type": "text/event-stream" } }) });
  try {
    const client = createOpenAiCompatibleClient({ kind: "custom", baseUrl: `http://127.0.0.1:${server.port}/v1`, model: "test", apiKey: "test-key" }, { warn: () => {} } as unknown as Logger);
    const events = [];
    for await (const event of client.stream({ messages: [], tools: [], maxTokens: 100 })) events.push(event);
    expect(events).toEqual([{ type: "text", text: "Jawaban." }, { type: "usage", usage: { promptTokens: 12345, completionTokens: 87 } }, { type: "done", finishReason: "stop" }]);
  } finally { server.stop(true); }
});

test("429 is surfaced once and switching provider/model uses the exact endpoint, key and model", async () => {
  const requests: { path: string; key: string | null; model: string }[] = [];
  const observations: ModelLimitStatus[] = [];
  const server = Bun.serve({ port: 0, hostname: "127.0.0.1", async fetch(req) {
    const { model } = await req.json() as { model: string };
    const path = new URL(req.url).pathname;
    requests.push({ path, key: req.headers.get("authorization"), model });
    if (path.startsWith("/a") && model === "limited") return Response.json([{ error: { code: 429, message: "RESOURCE_EXHAUSTED", details: [{ retryDelay: "9s" }] } }], { status: 429 });
    return new Response('data: {"choices":[{"delta":{"content":"Halo!"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', { headers: { "Content-Type": "text/event-stream" } });
  } });
  const consume = async (path: string, model: string) => {
    const client = createOpenAiCompatibleClient({ kind: "custom", name: path, baseUrl: `http://127.0.0.1:${server.port}/${path}`, model, apiKey: `${path}-key`, onObservation: async (s) => { observations.push(s); } }, { warn: () => {} } as unknown as Logger);
    const out = [];
    for await (const e of client.stream({ messages: [{ role: "user", content: "halo" }], tools: [], maxTokens: 20 })) out.push(e);
    return out;
  };
  try {
    await expect(consume("a", "limited")).rejects.toThrow("a / limited");
    await consume("b", "limited");
    await consume("a", "other");
    expect(requests).toEqual([
      { path: "/a/chat/completions", key: "Bearer a-key", model: "limited" },
      { path: "/b/chat/completions", key: "Bearer b-key", model: "limited" },
      { path: "/a/chat/completions", key: "Bearer a-key", model: "other" },
    ]);
    expect(observations.map((s) => s.status)).toEqual(["limited", "available", "available"]);
  } finally { server.stop(true); }
});

test("unconfigured provider labels its response and never invents router tool calls", async () => {
  const client = createMockClient();
  const events = [];
  for await (const event of client.stream({
    messages: [{ role: "user", content: "Periksa router dan safe mode" }],
    tools: [{ type: "function", function: { name: "router_tool", description: "Router", parameters: {} } }],
    maxTokens: 100,
  })) events.push(event);
  expect(events.some((event) => event.type === "tool_calls")).toBe(false);
  expect(events.filter((event) => event.type === "text").map((event) => event.text).join("")).toContain("[MOCK PROVIDER]");
  expect(events.at(-1)?.type).toBe("done");
});
