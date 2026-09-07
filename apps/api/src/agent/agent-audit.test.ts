import { describe, expect, test, beforeEach } from "bun:test";
import {
  buildProviderMessages,
  buildProviderTools,
  createOpenAiCompatibleClient,
  describeProviderRequest,
  type ChatMessage,
  type ChatToolCall,
} from "./chat-client";
import { createAgentLoop, selectRelevantTools, MAX_PROVIDER_TOOLS, type RunEvent } from "./loop";
import { createFallbackChatClient, describeStreamFailure, type FallbackCandidate } from "./model-fallback";
import { CentralRateLimiter } from "./rate-limiter";
import { startCompaction, latestSummary } from "./compaction";
import { createDb, type Database } from "../db";
import { agentRuns, conversations, messages, toolExecutions, workspaces } from "../db/schema";
import { eq } from "drizzle-orm";
import type { NormalizedTool } from "../policies/normalize";
import type { Logger } from "../lib/logger";
import { AppError } from "../lib/errors";

/**
 * Audit pasca-perbaikan: satu pesan sederhana → satu tool cek koneksi →
 * respons berhasil; 400 tidak di-retry; payload valid lintas provider;
 * kuota tercatat akurat; guard anti-loop; read-only tetap dijaga.
 */

const silentLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  child: () => silentLogger,
} as unknown as Logger;

let db: Database;
beforeEach(async () => {
  db = createDb(":memory:");
  await db.run("select 1");
});

const stubCoordinator = { recordAction: () => {}, getActionCount: () => 0 };
const probeOnlyDispatcher = {
  check: async () => {
    throw new Error("dispatcher must not be consulted for the connection probe");
  },
};

function toolCall(id: string, name: string, args = "{}"): ChatToolCall {
  return { id, name, argumentsJson: args };
}

function sseToolCall(id: string, name: string, args = "{}"): string {
  const first = JSON.stringify({
    choices: [
      {
        delta: { tool_calls: [{ index: 0, id, type: "function", function: { name, arguments: args } }] },
        finish_reason: null,
      },
    ],
  });
  const second = JSON.stringify({ choices: [{ delta: {}, finish_reason: "tool_calls" }] });
  return `data: ${first}\n\ndata: ${second}\n\ndata: [DONE]\n\n`;
}

function sseText(text: string, usage?: { prompt_tokens: number; completion_tokens: number }): string {
  const first = JSON.stringify({ choices: [{ delta: { content: text }, finish_reason: null }] });
  let out = `data: ${first}\n\n`;
  if (usage) out += `data: ${JSON.stringify({ choices: [], usage })}\n\n`;
  else out += `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\n`;
  return out + `data: [DONE]\n\n`;
}

/** Server stub yang melayani skrip respons per-request + merekam body. */
function scriptedServer(script: ((body: Record<string, unknown>) => Response)[]) {
  const bodies: Record<string, unknown>[] = [];
  let hits = 0;
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(req) {
      const body = (await req.json()) as Record<string, unknown>;
      bodies.push(body);
      const fn = script[Math.min(hits, script.length - 1)]!;
      hits += 1;
      return fn(body);
    },
  });
  return { server, bodies, hits: () => hits };
}

function geminiClient(port: number, limiter?: CentralRateLimiter) {
  // Limiter baru per pemakaian agar test saling terisolasi (bukan global).
  return createOpenAiCompatibleClient(
    { kind: "gemini", baseUrl: `http://127.0.0.1:${port}/v1`, model: "gemini-2.0-flash", apiKey: "audit-key-12345678" },
    silentLogger,
    { limiter: limiter ?? new CentralRateLimiter() },
  );
}

async function setupRun() {
  const [u] = await db.insert(workspaces).values({ name: "audit" }).returning();
  const [c] = await db.insert(conversations).values({ userId: u!.id, title: "t" }).returning();
  const [m] = await db
    .insert(messages)
    .values({ conversationId: c!.id, role: "user", content: { text: "coba test lagi" }, status: "complete", seq: 1 })
    .returning();
  const [r] = await db.insert(agentRuns).values({ conversationId: c!.id, userId: u!.id, status: "queued" }).returning();
  return { userId: u!.id, conversationId: c!.id, userMessageId: m!.id, runId: r!.id };
}

function connCatalog(): NormalizedTool[] {
  return [];
}

describe("audit payload tool-call lintas provider", () => {
  test("assistant+tool_calls dengan content null dinormalisasi menjadi string kosong (anti-400 Gemini)", () => {
    const wire = buildProviderMessages(
      [
        { role: "system", content: "s" },
        { role: "user", content: "coba test lagi" },
        { role: "assistant", content: null, toolCalls: [toolCall("call_1", "system_check_connection")] },
        { role: "tool", content: '{"ok":true}', toolCallId: "call_1" },
      ],
      "gemini",
    );
    expect(wire[2]).toMatchObject({ role: "assistant", content: "" });
    expect(wire[2]!.tool_calls).toHaveLength(1);
    expect(wire[3]).toMatchObject({ role: "tool", tool_call_id: "call_1" });
  });

  test("system di tengah percakapan diubah menjadi user berprefix (anti-400 Gemini)", () => {
    const wire = buildProviderMessages(
      [
        { role: "system", content: "instruksi" },
        { role: "user", content: "halo" },
        { role: "system", content: "Batas aksi tercapai" },
      ],
      "gemini",
    );
    expect(wire[0]!.role).toBe("system");
    expect(wire[2]).toMatchObject({ role: "user" });
    expect(String(wire[2]!.content)).toContain("Batas aksi tercapai");
  });

  test("extra_content hanya diteruskan ke gemini, dibuang untuk provider ketat lain", () => {
    const msgs: ChatMessage[] = [
      { role: "user", content: "x" },
      {
        role: "assistant",
        content: "",
        toolCalls: [{ id: "c1", name: "t", argumentsJson: "{}", extraContent: { sig: "abc" } }],
      },
      { role: "tool", content: "ok", toolCallId: "c1" },
    ];
    const gemini = buildProviderMessages(msgs, "gemini");
    expect((gemini[1]!.tool_calls![0] as Record<string, unknown>).extra_content).toEqual({ sig: "abc" });
    const openrouter = buildProviderMessages(msgs, "openrouter");
    expect((openrouter[1]!.tool_calls![0] as Record<string, unknown>).extra_content).toBeUndefined();
  });

  test("tool_call_id yatim/duplikat ditolak lokal tanpa request HTTP (hemat kuota)", async () => {
    // yatim: hasil tool tanpa pemanggil
    expect(() =>
      buildProviderMessages(
        [
          { role: "user", content: "x" },
          { role: "tool", content: "ok", toolCallId: "ghost" },
        ],
        "gemini",
      ),
    ).toThrow(/tanpa pemanggil/);
    // tanpa jawaban: tool_calls tanpa hasil
    expect(() =>
      buildProviderMessages(
        [
          { role: "user", content: "x" },
          { role: "assistant", content: "", toolCalls: [toolCall("c1", "t")] },
        ],
        "gemini",
      ),
    ).toThrow(/tanpa hasil tool/);
    // tool_call_id kosong
    expect(() =>
      buildProviderMessages(
        [
          { role: "user", content: "x" },
          { role: "assistant", content: "", toolCalls: [toolCall("", "t")] },
        ],
        "gemini",
      ),
    ).toThrow(/tanpa id\/nama/);
  });

  test("buildProviderTools memberi default schema aman; deskripsi request terukur", () => {
    const tools = buildProviderTools([
      { type: "function", function: { name: "a", description: "d", parameters: {} } },
    ]);
    expect(tools[0]!.function.parameters).toEqual({});
    const diag = describeProviderRequest({
      messages: [{ role: "user", content: "halo" }],
      tools,
      maxTokens: 100,
    });
    expect(diag.messageCount).toBe(1);
    expect(diag.toolCount).toBe(1);
    expect(diag.estimatedTokens).toBeGreaterThan(100);
  });
});

describe("audit alur cek koneksi ujung-ke-ujung (HTTP nyata, tanpa router)", () => {
  test("1 pesan → 1 tool check_connection → selesai; tepat 2 request AI; payload req-2 valid", async () => {
    const { server, bodies, hits } = scriptedServer([
      () => new Response(sseToolCall("call_abc", "system_check_connection"), { headers: { "Content-Type": "text/event-stream" } }),
      () =>
        new Response(sseText("Belum terhubung ke router.", { prompt_tokens: 900, completion_tokens: 12 }), {
          headers: { "Content-Type": "text/event-stream" },
        }),
    ]);
    try {
      const ctx = await setupRun();
      const loop = createAgentLoop({
        db,
        logger: silentLogger,
        dispatcher: probeOnlyDispatcher as never,
        txCoordinator: stubCoordinator as never,
        catalog: { getCatalog: async () => connCatalog() },
        limits: { maxSteps: 5, maxToolCalls: 5, runTimeoutMs: 10_000, maxTokens: 500 },
      });
      const events: RunEvent[] = [];
      let executed = 0;
      const result = await loop.run(
        {
          ...ctx,
          connectionId: null,
          userText: "coba test lagi",
          policy: { userId: ctx.userId, connectionId: "none", mode: "read-only", modeVersion: 0, transactionState: "none" },
          client: geminiClient(server.port!),
          executeTool: async () => {
            executed += 1;
            return { ok: true, output: "must not reach executor" };
          },
          systemInstruction: "instruksi sistem audit",
        },
        async (e) => {
          events.push(e);
        },
      );
      expect(result.status).toBe("completed");
      expect(hits()).toBe(2); // tepat 2 request AI: tool-call + jawaban akhir
      expect(executed).toBe(0); // probe milik backend, tanpa dispatcher/eksekutor
      // Payload request kedua: assistant content string (bukan null) + pasangan id cocok
      const req2 = bodies[1]! as { messages: { role: string; content: unknown; tool_calls?: { id: string }[]; tool_call_id?: string }[] };
      const asst = req2.messages.find((m) => m.role === "assistant" && m.tool_calls?.length);
      expect(typeof asst!.content).toBe("string");
      const tool = req2.messages.find((m) => m.role === "tool");
      expect(tool!.tool_call_id).toBe(asst!.tool_calls![0]!.id);
      // Usage terakumulasi + jumlah request tercatat
      const [run] = await db.select().from(agentRuns).where(eq(agentRuns.id, ctx.runId));
      const usage = run!.usage as Record<string, unknown>;
      expect(usage).toMatchObject({ promptTokens: 900, completionTokens: 12, aiRequests: 2, toolCalls: 1 });
      expect(events.at(-1)?.type).toBe("run.completed");
      const [te] = await db.select().from(toolExecutions).where(eq(toolExecutions.runId, ctx.runId));
      expect(te).toMatchObject({ toolName: "system:check_connection", status: "completed" });
    } finally {
      server.stop(true);
    }
  });

  test("tool berhasil tetapi AI lanjutan 400 → gagal jujur TANPA retry; hasil tool dipertahankan", async () => {
    const { server, bodies, hits } = scriptedServer([
      () => new Response(sseToolCall("call_400", "system_check_connection"), { headers: { "Content-Type": "text/event-stream" } }),
      () =>
        new Response(JSON.stringify({ error: { message: "Request contains an invalid argument.", code: 400 } }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }),
    ]);
    try {
      const ctx = await setupRun();
      const loop = createAgentLoop({
        db,
        logger: silentLogger,
        dispatcher: probeOnlyDispatcher as never,
        txCoordinator: stubCoordinator as never,
        catalog: { getCatalog: async () => connCatalog() },
        limits: { maxSteps: 5, maxToolCalls: 5, runTimeoutMs: 10_000, maxTokens: 500 },
      });
      const events: RunEvent[] = [];
      const result = await loop.run(
        {
          ...ctx,
          connectionId: null,
          userText: "coba test lagi",
          policy: { userId: ctx.userId, connectionId: "none", mode: "read-only", modeVersion: 0, transactionState: "none" },
          client: geminiClient(server.port!),
          executeTool: async () => ({ ok: true, output: "never" }),
          systemInstruction: "s",
        },
        async (e) => {
          events.push(e);
        },
      );
      expect(result.status).toBe("failed");
      expect(hits()).toBe(2); // 400 TIDAK di-retry: 1 tool-call + 1 jawaban gagal
      expect(bodies).toHaveLength(2);
      const failed = events.find((e) => e.type === "run.failed");
      expect(failed?.payload.code).toBe("UPSTREAM_INVALID_REQUEST");
      // Tool tetap tercatat completed; pesan user-facing memuat hasil tool + kode
      const [te] = await db.select().from(toolExecutions).where(eq(toolExecutions.runId, ctx.runId));
      expect(te?.status).toBe("completed");
      const saved = await db.select().from(messages).where(eq(messages.conversationId, ctx.conversationId));
      const assistant = saved.find((m) => m.role === "assistant");
      const text = String((assistant?.content as { text?: string })?.text ?? "");
      expect(assistant?.status).toBe("failed");
      expect(text).toContain("UPSTREAM_INVALID_REQUEST");
      expect(text).toContain("Hasil tool yang berhasil disimpan");
    } finally {
      server.stop(true);
    }
  });

  test("output tool raksasa dibatasi sebelum dikirim ke model (hemat payload)", async () => {
    const big = "x".repeat(100_000);
    const seen: string[] = [];
    const { server, hits } = scriptedServer([
      () => new Response(sseToolCall("c1", "docs_routeros_search", '{"query":"x"}'), { headers: { "Content-Type": "text/event-stream" } }),
      (body) => {
        seen.push(JSON.stringify(body));
        return new Response(sseText("ok"), { headers: { "Content-Type": "text/event-stream" } });
      },
    ]);
    try {
      const ctx = await setupRun();
      const docsCatalog: NormalizedTool[] = [
        {
          fqName: "docs:routeros_search",
          rawName: "routeros_search",
          origin: "custom",
          risk: "read",
          classificationProvenance: "custom-manifest",
          capabilities: [],
          inputSchema: { type: "object", properties: { query: { type: "string" } } },
          description: "Cari dokumentasi",
          isGateway: false,
        },
      ];
      const loop = createAgentLoop({
        db,
        logger: silentLogger,
        dispatcher: { check: async () => ({ allowed: true as const, tool: docsCatalog[0] }) } as never,
        txCoordinator: stubCoordinator as never,
        catalog: { getCatalog: async () => docsCatalog },
        limits: { maxSteps: 5, maxToolCalls: 5, runTimeoutMs: 10_000, maxTokens: 500 },
      });
      await loop.run(
        {
          ...ctx,
          connectionId: null,
          userText: "cari dokumentasi bonding",
          policy: { userId: ctx.userId, connectionId: "none", mode: "read-only", modeVersion: 0, transactionState: "none" },
          client: geminiClient(server.port!),
          executeTool: async () => ({ ok: true, output: big }),
          systemInstruction: "s",
        },
        async () => {},
      );
      expect(hits()).toBe(2);
      const req2 = seen[0]!;
      // payload req-2 memuat hasil tool terpotong (±8000 + bungkus JSON), bukan 100rb char
      expect(req2.length).toBeLessThan(20_000);
    } finally {
      server.stop(true);
    }
  });
});

describe("audit retry / fallback / rate limit", () => {
  test("400 tidak di-retry berulang pada level client (tepat 1 hit)", async () => {
    let hits = 0;
    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: () => {
        hits += 1;
        return new Response(JSON.stringify({ error: { message: "Request contains an invalid argument.", code: 400 } }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      },
    });
    try {
      const client = geminiClient(server.port!);
      const err = await (async () => {
        try {
          for await (const _ of client.stream({ messages: [{ role: "user", content: "halo" }], tools: [], maxTokens: 20 })) {
            /* drain */
          }
          return null;
        } catch (e) {
          return e;
        }
      })();
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).code).toBe("UPSTREAM_INVALID_REQUEST");
      expect(hits).toBe(1);
    } finally {
      server.stop(true);
    }
  });

  test("429 biasa memakai kode RATE_LIMITED + menghormati Retry-After tanpa retry default", async () => {
    const limiter = new CentralRateLimiter({ jitterFn: () => 0 });
    let hits = 0;
    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: () => {
        hits += 1;
        return new Response(JSON.stringify({ error: { message: "Rate limit exceeded, try again", code: 429 } }), {
          status: 429,
          headers: { "Content-Type": "application/json", "retry-after": "45" },
        });
      },
    });
    try {
      const client = createOpenAiCompatibleClient(
        { kind: "openrouter", baseUrl: `http://127.0.0.1:${server.port!}/v1`, model: "rl-model", apiKey: "rl-key-12345678" },
        silentLogger,
        { limiter },
      );
      const err = await (async () => {
        try {
          for await (const _ of client.stream({ messages: [{ role: "user", content: "halo" }], tools: [], maxTokens: 20 })) {
            /* drain */
          }
          return null;
        } catch (e) {
          return e;
        }
      })();
      expect((err as AppError).code).toBe("UPSTREAM_RATE_LIMITED");
      expect(hits).toBe(1); // default maxRetries 0: tepat 1 hit
      const blocked = limiter.isBlocked("openrouter:rl-model");
      expect(blocked.blocked).toBe(true);
      const waitMs = Date.parse(blocked.retryAt!) - Date.now();
      expect(waitMs).toBeGreaterThan(30_000); // Retry-After 45 dtk dihormati
    } finally {
      server.stop(true);
    }
  });

  test("RPD habis menghentikan request (acquire melempar QUOTA_EXHAUSTED)", async () => {
    let now = 1_000_000;
    const limiter = new CentralRateLimiter({ nowFn: () => now, sleepFn: async (ms) => void (now += ms), jitterFn: () => 0 });
    limiter.notifyDailyQuotaExhausted({ modelKey: "gemini:flash", resetAtMs: now + 3_600_000, reason: "RPD habis (uji)" });
    await expect(
      limiter.acquire({ modelKey: "gemini:flash", providerKind: "gemini", estimatedTokens: 100, timeoutMs: 50 }),
    ).rejects.toMatchObject({ code: "QUOTA_EXHAUSTED" });
  });

  test("fallback TIDAK dipicu oleh 400 (payload rusak tidak membakar semua model)", async () => {
    const primary: FallbackCandidate = { providerId: "g", providerKind: "gemini", model: "flash", enabled: true, apiKey: "k1" };
    const backup: FallbackCandidate = { providerId: "o", providerKind: "openrouter", model: "backup", enabled: true, apiKey: "k2" };
    // Klasifikasi langsung: pesan 400 yang menyebut kata kuota tetap bukan-fallback.
    expect(describeStreamFailure(502, "Permintaan ditolak oleh provider AI (400, argumen tidak valid) pada X / Y. bukan kuota — tidak di-retry.").shouldFallback).toBe(false);
    expect(describeStreamFailure(400, "Request contains an invalid argument.").shouldFallback).toBe(false);
    expect(describeStreamFailure(429, "Rate limit exceeded").shouldFallback).toBe(true);

    let calls = 0;
    const failing = (label: string) => ({
      modelLabel: label,
      async *stream() {
        calls += 1;
        throw new AppError("UPSTREAM_INVALID_REQUEST", "Permintaan ditolak oleh provider AI (400, argumen tidak valid).", 502);
        yield { type: "done" as const };
      },
    });
    const client = createFallbackChatClient(primary, [primary, backup], (c) => failing(`${c.providerKind}:${c.model}`), {});
    await expect(
      (async () => {
        for await (const _ of client.stream({ messages: [{ role: "user", content: "halo" }], tools: [], maxTokens: 10 })) {
          /* drain */
        }
      })(),
    ).rejects.toMatchObject({ code: "UPSTREAM_INVALID_REQUEST" });
    expect(calls).toBe(1); // berhenti di model pertama, tanpa fallback berantai
  });

  test("pembatalan menghentikan antrean limiter (CANCELLED)", async () => {
    const limiter = new CentralRateLimiter({ jitterFn: () => 0 });
    // Penuhi bucket RPM (4 request) agar acquire berikutnya harus antre.
    for (let i = 0; i < 4; i++) {
      const t = await limiter.acquire({ modelKey: "custom:m", providerKind: "custom", estimatedTokens: 10 });
      t.complete(10);
    }
    const controller = new AbortController();
    const pending = limiter.acquire({
      modelKey: "custom:m",
      providerKind: "custom",
      estimatedTokens: 10,
      signal: controller.signal,
      timeoutMs: 120_000,
    });
    // Batalkan saat menunggu kapasitas → CANCELLED, bukan menunggu 60 dtk.
    setTimeout(() => controller.abort(), 50);
    await expect(pending).rejects.toMatchObject({ code: "CANCELLED" });
  });
});

describe("audit loop guards, usage, dan keamanan", () => {
  function scriptedClient(script: { toolCalls?: ChatToolCall[]; text: string; usage?: { promptTokens: number; completionTokens: number } }[]) {
    let turn = 0;
    return {
      modelLabel: "scripted-audit",
      async *stream() {
        const step = script[Math.min(turn, script.length - 1)]!;
        turn += 1;
        if (step.toolCalls) yield { type: "tool_calls" as const, toolCalls: step.toolCalls };
        yield { type: "text" as const, text: step.text };
        if (step.usage) yield { type: "usage" as const, usage: step.usage };
        yield { type: "done" as const };
      },
    };
  }

  function docsCatalog(): NormalizedTool[] {
    return [
      {
        fqName: "docs:routeros_search",
        rawName: "routeros_search",
        origin: "custom",
        risk: "read",
        classificationProvenance: "custom-manifest",
        capabilities: [],
        inputSchema: { type: "object", properties: { query: { type: "string" } } },
        description: "Cari dokumentasi",
        isGateway: false,
      },
    ];
  }

  test("tool identik 3x menghentikan run (TOOL_LOOP_DETECTED); eksekusi cukup 1x via cache", async () => {
    const ctx = await setupRun();
    const loop = createAgentLoop({
      db,
      logger: silentLogger,
      dispatcher: { check: async () => ({ allowed: true as const, tool: docsCatalog()[0] }) } as never,
      txCoordinator: stubCoordinator as never,
      catalog: { getCatalog: async () => docsCatalog() },
      limits: { maxSteps: 8, maxToolCalls: 8, runTimeoutMs: 10_000, maxTokens: 100 },
    });
    let executed = 0;
    const events: RunEvent[] = [];
    const result = await loop.run(
      {
        ...ctx,
        connectionId: null,
        userText: "cari x",
        policy: { userId: ctx.userId, connectionId: "none", mode: "read-only", modeVersion: 0, transactionState: "none" },
        client: scriptedClient([
          { toolCalls: [toolCall("a1", "docs_routeros_search", '{"query":"x"}')], text: "" },
          { toolCalls: [toolCall("a2", "docs_routeros_search", '{"query":"x"}')], text: "" },
          { toolCalls: [toolCall("a3", "docs_routeros_search", '{"query":"x"}')], text: "" },
          { text: "tidak tercapai" },
        ]),
        executeTool: async () => {
          executed += 1;
          return { ok: true, output: "hasil sama" };
        },
        systemInstruction: "s",
      },
      async (e) => {
        events.push(e);
      },
    );
    expect(result.status).toBe("failed");
    expect(events.find((e) => e.type === "run.failed")?.payload.code).toBe("TOOL_LOOP_DETECTED");
    expect(executed).toBe(1); // panggilan ke-2 dari cache, ke-3 diblokir
  });

  test("usage token diakumulasi lintas turn (bukan ditimpa turn terakhir)", async () => {
    const ctx = await setupRun();
    const catalog = docsCatalog();
    const loop = createAgentLoop({
      db,
      logger: silentLogger,
      dispatcher: { check: async () => ({ allowed: true as const, tool: catalog[0] }) } as never,
      txCoordinator: stubCoordinator as never,
      catalog: { getCatalog: async () => catalog },
      limits: { maxSteps: 5, maxToolCalls: 5, runTimeoutMs: 10_000, maxTokens: 100 },
    });
    await loop.run(
      {
        ...ctx,
        connectionId: null,
        userText: "cari x",
        policy: { userId: ctx.userId, connectionId: "none", mode: "read-only", modeVersion: 0, transactionState: "none" },
        client: scriptedClient([
          { toolCalls: [toolCall("u1", "docs_routeros_search", '{"query":"x"}')], text: "", usage: { promptTokens: 100, completionTokens: 10 } },
          { text: "selesai", usage: { promptTokens: 200, completionTokens: 20 } },
        ]),
        executeTool: async () => ({ ok: true, output: "hasil" }),
        systemInstruction: "s",
      },
      async () => {},
    );
    const [run] = await db.select().from(agentRuns).where(eq(agentRuns.id, ctx.runId));
    expect(run!.usage as Record<string, unknown>).toMatchObject({
      promptTokens: 300,
      completionTokens: 30,
      toolCalls: 1,
    });
  });

  test("read-only + probe koneksi + penolakan tulis: run selesai jujur, tanpa eksekusi tulis", async () => {
    const ctx = await setupRun();
    const writeTool: NormalizedTool = {
      fqName: "mt:write_tool",
      rawName: "write_tool",
      origin: "upstream-mikrotik",
      risk: "write",
      classificationProvenance: "upstream-annotation",
      capabilities: [],
      inputSchema: { type: "object", properties: {} },
      description: "Tool tulis",
      isGateway: false,
    };
    const catalog: NormalizedTool[] = [...docsCatalog(), writeTool];
    let executed = 0;
    const loop = createAgentLoop({
      db,
      logger: silentLogger,
      dispatcher: {
        check: async (input: { toolFqName: string }) =>
          input.toolFqName === "docs:routeros_search"
            ? { allowed: true as const, tool: catalog[0] }
            : { allowed: false as const, code: "WRITE_DISABLED", message: "Mode Read-Only aktif" },
      } as never,
      txCoordinator: stubCoordinator as never,
      catalog: { getCatalog: async () => catalog },
      limits: { maxSteps: 6, maxToolCalls: 6, runTimeoutMs: 10_000, maxTokens: 100 },
    });
    const events: RunEvent[] = [];
    const result = await loop.run(
      {
        ...ctx,
        connectionId: null,
        userText: "apakah write aktif dan cari x",
        policy: { userId: ctx.userId, connectionId: "none", mode: "read-only", modeVersion: 0, transactionState: "none" },
        client: scriptedClient([
          { toolCalls: [toolCall("p1", "system_check_connection")], text: "" },
          { toolCalls: [toolCall("w1", "mt_write_tool")], text: "" },
          { text: "Mode read-only; tulis ditolak." },
        ]),
        executeTool: async () => {
          executed += 1;
          return { ok: true, output: "MUST NOT EXECUTE" };
        },
        systemInstruction: "s",
      },
      async (e) => {
        events.push(e);
      },
    );
    expect(result.status).toBe("completed");
    expect(executed).toBe(0);
    expect(events.filter((e) => e.type === "tool.failed").length).toBe(1);
    expect(events.filter((e) => e.type === "tool.completed").length).toBe(1);
  });

  test("filter tool relevan: katalog kecil utuh; katalog besar dibatasi dengan probe+docs aman", () => {    const small: NormalizedTool[] = Array.from({ length: 10 }, (_, i) => ({
      fqName: `mt:tool_${i}`,
      rawName: `tool_${i}`,
      origin: "upstream-mikrotik",
      risk: "read",
      classificationProvenance: "upstream-annotation+read-only-registration",
      capabilities: [],
      inputSchema: { type: "object", properties: {} },
      description: `Tool ${i}`,
      isGateway: false,
    }));
    expect(selectRelevantTools(small, "cek bonding")).toHaveLength(10);
    const big: NormalizedTool[] = [
      {
        fqName: "system:check_connection",
        rawName: "check_connection",
        origin: "custom",
        risk: "read",
        classificationProvenance: "custom-manifest",
        capabilities: [],
        inputSchema: { type: "object", properties: {} },
        description: "probe",
        isGateway: false,
      },
      {
        fqName: "docs:routeros_search",
        rawName: "routeros_search",
        origin: "upstream-rosetta",
        risk: "read",
        classificationProvenance: "upstream-annotation+read-only-registration",
        capabilities: [],
        inputSchema: { type: "object", properties: {} },
        description: "docs",
        isGateway: false,
      },
      ...Array.from({ length: 70 }, (_, i) => ({
        fqName: `mt:tool_${i}`,
        rawName: `tool_${i}`,
        origin: "upstream-mikrotik" as const,
        risk: "read" as const,
        classificationProvenance: "upstream-annotation+read-only-registration" as const,
        capabilities: [] as string[],
        inputSchema: { type: "object", properties: {} },
        description: i === 5 ? "mengelola bonding interface agregasi" : `Tool generik ${i}`,
        isGateway: false,
      })),
    ];
    const picked = selectRelevantTools(big, "cek bonding ether1");
    expect(picked.length).toBe(MAX_PROVIDER_TOOLS);
    expect(picked.some((t) => t.fqName === "system:check_connection")).toBe(true);
    expect(picked.some((t) => t.fqName === "docs:routeros_search")).toBe(true);
    expect(picked.some((t) => t.fqName === "mt:tool_5")).toBe(true);
  });
});

describe("audit compaction dan riwayat tool", () => {
  test("compaction merangkum riwayat berisi run gagal + timeline tool tanpa merusak pasangan tool", async () => {
    const [u] = await db.insert(workspaces).values({ name: "compact-audit" }).returning();
    const [conv] = await db.insert(conversations).values({ userId: u!.id, title: "t" }).returning();
    // Riwayat campuran: user, assistant gagal (dengan timeline tool JSON), user baru.
    await db.insert(messages).values({ conversationId: conv!.id, role: "user", content: { text: "coba test lagi" }, status: "complete", seq: 1 });
    await db.insert(messages).values({
      conversationId: conv!.id,
      role: "assistant",
      content: {
        text: "Jawaban belum dapat diselesaikan (UPSTREAM_INVALID_REQUEST).",
        runId: "run-lama",
        timeline: [
          { runId: "run-lama", seq: 1, type: "tool.started", payload: { callId: "c1", name: "system:check_connection" } },
          { runId: "run-lama", seq: 2, type: "tool.completed", payload: { callId: "c1", name: "system:check_connection" } },
        ],
      },
      status: "failed",
      seq: 2,
    });
    for (let i = 3; i <= 15; i++) {
      await db.insert(messages).values({
        conversationId: conv!.id,
        role: i % 2 ? "user" : "assistant",
        content: { text: `pesan ${i} tentang router` },
        status: "complete",
        seq: i,
      });
    }
    let summarized = 0;
    const deps = {
      db,
      logger: silentLogger,
      getProvider: async () =>
        ({
          client: {
            modelLabel: "test:fake",
            async *stream() {
              summarized += 1;
              yield { type: "text" as const, text: "Ringkasan: pengguna menguji koneksi; satu run gagal 400." };
              yield { type: "done" as const };
            },
          },
          model: "fake",
          provider: "test",
        }) as never,
    };
    await startCompaction(deps, { userId: u!.id, conversationId: conv!.id, reason: "manual" });
    for (let i = 0; i < 100 && !(await latestSummary(db, conv!.id)); i++) await new Promise((r) => setTimeout(r, 20));
    const sum = await latestSummary(db, conv!.id);
    // Tepat 1 request AI summarization; pesan sumber utuh (tidak ada penghapusan).
    expect(summarized).toBe(1);
    expect(sum?.version).toBe(1);
    expect(sum?.throughSeq).toBeGreaterThan(0);
    const all = await db.select().from(messages).where(eq(messages.conversationId, conv!.id));
    expect(all.length).toBe(15);
    // Pasangan tool in-memory tidak disimpan sebagai turn tool di DB —
    // tidak ada orphan tool_calls yang bisa meracuni request berikutnya.
    expect(all.every((m) => m.role === "user" || m.role === "assistant")).toBe(true);
  });
});
