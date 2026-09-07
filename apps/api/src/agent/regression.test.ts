import { describe, expect, test, beforeEach } from "bun:test";
import { desc, eq } from "drizzle-orm";
import { createDb, type Database } from "../db";
import { agentRuns, conversations, messages, routerConnections, toolExecutions, workspaces } from "../db/schema";
import { createAgentLoop, findDirectToolsForQuery, selectRelevantTools, CONNECTION_CHECK_TOOL, type RunEvent } from "./loop";
import { createOpenAiCompatibleClient, type ChatClient, type ChatToolCall } from "./chat-client";
import { CentralRateLimiter } from "./rate-limiter";
import type { NormalizedTool } from "../policies/normalize";
import type { Logger } from "../lib/logger";
import { TransactionCoordinator } from "../transactions/coordinator";
import { PolicyDispatcher } from "../policies/dispatcher";
import { normalizeUpstreamTools } from "../policies/normalize";
import { buildTestChatApp, type StubTransactions } from "../routes/test-deps";

/**
 * Regresi end-to-end (SQLite in-memory + provider palsu + MCP mock).
 * Mengunci perbaikan audit 2026-09-07: finalisasi terstruktur, empty-final,
 * lazy transaction, redirect discovery, cache, antrean, resume, payload HTTP.
 */

const silentLogger = { info() {}, warn() {}, error() {}, debug() {}, child() {} } as unknown as Logger;
let db: Database;
beforeEach(async () => {
  db = createDb(":memory:");
  await db.run("select 1");
});

function readTool(fq = "mt:list_ip_addresses", raw = "list_ip_addresses"): NormalizedTool {
  return { fqName: fq, rawName: raw, origin: "upstream-mikrotik", risk: "read", classificationProvenance: "upstream-annotation", capabilities: ["ip", "address"], inputSchema: { type: "object", properties: {} }, description: "List IP addresses", isGateway: false };
}
function writeTool(): NormalizedTool {
  return { fqName: "mt:set_identity", rawName: "set_identity", origin: "upstream-mikrotik", risk: "write", classificationProvenance: "upstream-annotation", capabilities: [], inputSchema: { type: "object", properties: { name: { type: "string" } } }, description: "Ubah nama router", isGateway: false };
}
function findTool(): NormalizedTool {
  return { fqName: "mt:find_tools", rawName: "find_tools", origin: "upstream-mikrotik", risk: "read", classificationProvenance: "upstream-annotation", capabilities: [], inputSchema: { type: "object", properties: { query: { type: "string" } } }, description: "Cari tool", isGateway: false };
}
function scripted(turns: { text?: string; calls?: ChatToolCall[] }[]): ChatClient {
  let i = 0;
  return {
    modelLabel: "scripted",
    async *stream() {
      const t = turns[Math.min(i, turns.length - 1)]!;
      i += 1;
      if (t.calls) yield { type: "tool_calls", toolCalls: t.calls };
      if (t.text) yield { type: "text", text: t.text };
      yield { type: "done", finishReason: "stop" };
    },
  };
}
async function setup(userText = "cek router") {
  const [u] = await db.insert(workspaces).values({ name: "reg" }).returning();
  const [c] = await db.insert(conversations).values({ userId: u!.id, title: "t" }).returning();
  const [m] = await db.insert(messages).values({ conversationId: c!.id, role: "user", content: { text: userText }, seq: 1 }).returning();
  const [r] = await db.insert(agentRuns).values({ conversationId: c!.id, userId: u!.id, status: "queued" }).returning();
  return { u: u!, c: c!, m: m!, r: r! };
}
const allowAll = (catalog: NormalizedTool[]) => ({ check: async (i: { toolFqName: string }) => {
  const tool = catalog.find((t) => t.fqName === i.toolFqName);
  return tool ? { allowed: true as const, tool } : { allowed: false as const, code: "TOOL_UNSUPPORTED", message: "tidak ada" };
} });
const coordinatorStub = { recordAction() {}, getActionCount: () => 0 };
function loopWith(catalog: NormalizedTool[], dispatcher?: never) {
  return createAgentLoop({ db, logger: silentLogger, dispatcher: (dispatcher ?? allowAll(catalog)) as never, txCoordinator: coordinatorStub as never, catalog: { getCatalog: async () => catalog }, limits: { maxSteps: 6, maxToolCalls: 10, runTimeoutMs: 10000, maxTokens: 200 } });
}
async function assistantOf(convId: string) {
  return (await db.select().from(messages).where(eq(messages.conversationId, convId))).find((x) => x.role === "assistant");
}

describe("finalisasi terstruktur (tanpa klasifikasi substring)", () => {
  test("preamble + tool + final kosong → failed EMPTY_RESPONSE dengan hitungan + ajakan lanjut", async () => {
    const { u, c, m, r } = await setup();
    const catalog = [readTool()];
    // Nama tool sukses TIDAK mengandung kata "gagal/ditolak/sukses" — klasifikasi
    // substring lama akan salah hitung; struktur baru memakai flag ok.
    const events: RunEvent[] = [];
    const out = await loopWith(catalog).run({
      runId: r.id, userId: u.id, conversationId: c.id, userMessageId: m.id, connectionId: "conn-1",
      userText: "cek router",
      policy: { userId: u.id, connectionId: "conn-1", mode: "read-only", modeVersion: 1, transactionState: "none" },
      client: scripted([
        { text: "Baik, saya bantu.", calls: [{ id: "c1", name: "mt_list_ip_addresses", argumentsJson: "{}" }] },
        {},
      ]),
      systemInstruction: "s", executeTool: async () => ({ ok: true, output: "10.0.0.1/24" }),
    }, async (e) => { events.push(e); });
    expect(out.status).toBe("failed");
    expect(events.at(-1)).toMatchObject({ type: "run.failed", payload: { code: "EMPTY_RESPONSE" } });
    const saved = await assistantOf(c.id);
    const text = String((saved?.content as { text?: string })?.text ?? "");
    expect(text).toContain("Baik, saya bantu.");
    expect(text).toContain("1 berhasil, 0 gagal/ditolak");
    expect(text).toContain("Lanjutkan pemeriksaan");
    expect(text).not.toContain("[mt:list_ip_addresses]");
    expect(text).not.toContain("⚠️");
    const outcome = (saved?.content as { outcome?: Record<string, unknown> })?.outcome;
    expect(outcome).toMatchObject({ status: "failed", code: "EMPTY_RESPONSE", toolSucceeded: 1, toolFailed: 0 });
  });

  test("teks parsial + provider throw → preamble dipertahankan + penutup manusiawi", async () => {
    const { u, c, m, r } = await setup();
    let turn = 0;
    const client: ChatClient = {
      modelLabel: "s",
      async *stream() {
        turn += 1;
        if (turn === 1) {
          yield { type: "tool_calls", toolCalls: [{ id: "c1", name: "mt_list_ip_addresses", argumentsJson: "{}" }] };
          yield { type: "done", finishReason: "stop" };
        } else {
          yield { type: "text", text: "sebagian." };
          throw new Error("provider down");
        }
      },
    };
    const out = await loopWith([readTool()]).run({
      runId: r.id, userId: u.id, conversationId: c.id, userMessageId: m.id, connectionId: "conn-1",
      userText: "cek", policy: { userId: u.id, connectionId: "conn-1", mode: "read-only", modeVersion: 1, transactionState: "none" },
      client, systemInstruction: "s", executeTool: async () => ({ ok: true, output: "ether1" }),
    }, async () => {});
    expect(out.status).toBe("failed");
    const text = String(((await assistantOf(c.id))?.content as { text?: string })?.text ?? "");
    expect(text).toContain("sebagian.");
    expect(text).toContain("provider down");
    expect(text).toContain("1 berhasil");
  });

  test("finish_reason length/content_filter → failed, bukan completed", async () => {
    for (const reason of ["length", "content_filter"]) {
      const { u, c, m, r } = await setup();
      const client: ChatClient = {
        modelLabel: "s",
        async *stream() {
          yield { type: "text", text: "potong" };
          yield { type: "done", finishReason: reason };
        },
      };
      const out = await loopWith([readTool()]).run({
        runId: r.id, userId: u.id, conversationId: c.id, userMessageId: m.id, connectionId: null,
        userText: "cek", policy: { userId: u.id, connectionId: "none", mode: "read-only", modeVersion: 0, transactionState: "none" },
        client, systemInstruction: "s", executeTool: async () => ({ ok: true, output: "x" }),
      }, async () => {});
      expect(out.status).toBe("failed");
    }
  });
});

describe("batch tool + hasil kosong + gagal (satu giliran)", () => {
  test("3 tool segiliran (2 sukses + 1 gagal): semua dieksekusi, status per-tool jujur", async () => {
    const { u, c, m, r } = await setup();
    const catalog = [readTool("mt:a", "a"), readTool("mt:b", "b"), readTool("mt:c", "c")];
    const events: RunEvent[] = [];
    let reqs = 0;
    const client: ChatClient = {
      modelLabel: "s",
      async *stream() {
        reqs += 1;
        if (reqs === 1) {
          yield { type: "tool_calls", toolCalls: [
            { id: "k1", name: "mt_a", argumentsJson: "{}" },
            { id: "k2", name: "mt_b", argumentsJson: "{}" },
            { id: "k3", name: "mt_c", argumentsJson: "{}" },
          ] };
        } else yield { type: "text", text: "Ringkasan: a dan c ok, b gagal." };
        yield { type: "done", finishReason: "stop" };
      },
    };
    const out = await loopWith(catalog).run({
      runId: r.id, userId: u.id, conversationId: c.id, userMessageId: m.id, connectionId: "conn-1",
      userText: "cek a b c", policy: { userId: u.id, connectionId: "conn-1", mode: "read-only", modeVersion: 1, transactionState: "none" },
      client, systemInstruction: "s",
      executeTool: async ({ fqName }) => fqName === "mt:b" ? { ok: false, output: "timeout", errorCode: "TOOL_FAILED" } : { ok: true, output: `out-${fqName}` },
    }, async (e) => { events.push(e); });
    expect(out.status).toBe("completed");
    expect(reqs).toBe(2);
    expect(events.filter((e) => e.type === "tool.completed").length).toBe(2);
    expect(events.filter((e) => e.type === "tool.failed").length).toBe(1);
  });

  test("output tool kosong → diteruskan sebagai hasil 0-baris, run completed", async () => {
    const { u, c, m, r } = await setup();
    const out = await loopWith([readTool()]).run({
      runId: r.id, userId: u.id, conversationId: c.id, userMessageId: m.id, connectionId: "conn-1",
      userText: "cek", policy: { userId: u.id, connectionId: "conn-1", mode: "read-only", modeVersion: 1, transactionState: "none" },
      client: scripted([
        { calls: [{ id: "c1", name: "mt_list_ip_addresses", argumentsJson: "{}" }] },
        { text: "Tidak ada data." },
      ]),
      systemInstruction: "s", executeTool: async () => ({ ok: true, output: "   \n " }),
    }, async () => {});
    expect(out.status).toBe("completed");
    const rows = await db.select().from(toolExecutions).where(eq(toolExecutions.runId, r.id));
    expect(rows[0]?.status).toBe("completed");
  });
});

describe("discovery hemat: redirect + normalisasi + cache", () => {
  test("find_tools untuk kemampuan yang sudah tersedia → dialihkan tanpa eksekusi pencarian", async () => {
    const catalog = [findTool(), readTool()];
    expect(findDirectToolsForQuery("ip address print", catalog).map((t) => t.fqName)).toContain("mt:list_ip_addresses");
    const { u, c, m, r } = await setup();
    let executed = 0;
    const events: RunEvent[] = [];
    const out = await loopWith(catalog).run({
      runId: r.id, userId: u.id, conversationId: c.id, userMessageId: m.id, connectionId: "conn-1",
      userText: "cek ip", policy: { userId: u.id, connectionId: "conn-1", mode: "read-only", modeVersion: 1, transactionState: "none" },
      client: scripted([
        { calls: [{ id: "d1", name: "mt_find_tools", argumentsJson: '{"query":"ip address print"}' }] },
        { text: "Memakai tool langsung." },
      ]),
      systemInstruction: "s", executeTool: async () => { executed += 1; return { ok: true, output: "x" }; },
    }, async (e) => { events.push(e); });
    expect(out.status).toBe("completed");
    expect(executed).toBe(0);
    expect(events.find((e) => e.type === "tool.completed")?.payload).toMatchObject({ redirected: true });
  });

  test("kueri semakna (ip address vs ip address print detail) → 1 eksekusi, ke-2 dari cache", async () => {
    const docsTool: NormalizedTool = { fqName: "docs:routeros_search", rawName: "routeros_search", origin: "custom", risk: "read", classificationProvenance: "custom-manifest", capabilities: [], inputSchema: { type: "object", properties: {} }, description: "docs", isGateway: false };
    const catalog = [findTool(), docsTool];
    const { u, c, m, r } = await setup();
    let executed = 0;
    const events: RunEvent[] = [];
    const out = await loopWith(catalog).run({
      runId: r.id, userId: u.id, conversationId: c.id, userMessageId: m.id, connectionId: "conn-1",
      userText: "cek", policy: { userId: u.id, connectionId: "conn-1", mode: "read-only", modeVersion: 1, transactionState: "none" },
      client: scripted([
        { calls: [{ id: "d1", name: "mt_find_tools", argumentsJson: '{"query":"ip address"}' }] },
        { calls: [{ id: "d2", name: "mt_find_tools", argumentsJson: '{"query":"ip address print detail"}' }] },
        { text: "Selesai." },
      ]),
      systemInstruction: "s", executeTool: async () => { executed += 1; return { ok: true, output: "kandidat: list_ip_addresses" }; },
    }, async (e) => { events.push(e); });
    expect(out.status).toBe("completed");
    expect(executed).toBe(1);
    expect(events.filter((e) => e.type === "tool.completed" && (e.payload as { cached?: boolean }).cached).length).toBe(1);
  });

  test("hasil gagal dari cache tetap berstatus gagal", async () => {
    const { u, c, m, r } = await setup();
    const events: RunEvent[] = [];
    const out = await loopWith([readTool()]).run({
      runId: r.id, userId: u.id, conversationId: c.id, userMessageId: m.id, connectionId: "conn-1",
      userText: "cek", policy: { userId: u.id, connectionId: "conn-1", mode: "read-only", modeVersion: 1, transactionState: "none" },
      client: scripted([
        { calls: [{ id: "c1", name: "mt_list_ip_addresses", argumentsJson: "{}" }] },
        { calls: [{ id: "c2", name: "mt_list_ip_addresses", argumentsJson: "{}" }] },
        { text: "Gagal dua kali, saya laporkan." },
      ]),
      systemInstruction: "s", executeTool: async () => ({ ok: false, output: "boom", errorCode: "TOOL_FAILED" }),
    }, async (e) => { events.push(e); });
    expect(out.status).toBe("completed");
    const failed = events.filter((e) => e.type === "tool.failed");
    expect(failed.length).toBe(2);
    expect(events.some((e) => e.type === "tool.completed")).toBe(false);
  });

  test("mutasi menginvalidasi cache baca: read → write → read sama = 2 eksekusi baca", async () => {
    const catalog = [readTool(), writeTool()];
    const { u, c, m, r } = await setup();
    let reads = 0;
    const ensured: string[] = [];
    const out = await createAgentLoop({ db, logger: silentLogger, dispatcher: allowAll(catalog) as never,
      txCoordinator: { recordAction() {}, getActionCount: () => 0 } as never,
      catalog: { getCatalog: async () => catalog }, limits: { maxSteps: 6, maxToolCalls: 10, runTimeoutMs: 10000, maxTokens: 200 } }).run({
      runId: r.id, userId: u.id, conversationId: c.id, userMessageId: m.id, connectionId: "conn-1",
      userText: "ubah lalu cek",
      policy: { userId: u.id, connectionId: "conn-1", mode: "write", modeVersion: 1, transactionState: "active" },
      client: scripted([
        { calls: [{ id: "r1", name: "mt_list_ip_addresses", argumentsJson: "{}" }] },
        { calls: [{ id: "w1", name: "mt_set_identity", argumentsJson: '{"name":"X"}' }] },
        { calls: [{ id: "r2", name: "mt_list_ip_addresses", argumentsJson: "{}" }] },
        { text: "Selesai." },
      ]),
      systemInstruction: "s",
      ensureTransaction: async () => { ensured.push("tx"); return { ok: true, transactionId: "tx-1" }; },
      executeTool: async ({ fqName }) => { if (fqName === "mt:list_ip_addresses") reads += 1; return { ok: true, output: "ok" }; },
    }, async () => {});
    expect(out.status).toBe("completed");
    expect(reads).toBe(2);
  });

  test("selectRelevantTools: budget schema + probe selalu ada", () => {
    const big: NormalizedTool[] = Array.from({ length: 60 }, (_, i) => ({
      fqName: `mt:tool_${i}`, rawName: `tool_${i}`, origin: "upstream-mikrotik", risk: "read",
      classificationProvenance: "upstream-annotation", capabilities: [],
      inputSchema: { type: "object", properties: { p: { type: "string", description: "x".repeat(3000) } } },
      description: "y".repeat(500), isGateway: false,
    }));
    const picked = selectRelevantTools([...big, CONNECTION_CHECK_TOOL], "cek ip address");
    expect(picked.length).toBeLessThanOrEqual(48);
    expect(picked.some((t) => t.fqName === "system:check_connection")).toBe(true);
    const chars = JSON.stringify(picked).length;
    expect(chars).toBeLessThanOrEqual(70_000);
  });
});

describe("read-only intent pada connector Write (level loop)", () => {
  test("baca diizinkan, tulis ditolak, tanpa transaksi", async () => {
    const catalog = [readTool(), writeTool()];
    const readOnlyDispatcher = { check: async (i: { toolFqName: string }) => {
      const tool = catalog.find((t) => t.fqName === i.toolFqName);
      if (!tool) return { allowed: false as const, code: "TOOL_UNSUPPORTED", message: "tidak ada" };
      if (tool.risk !== "read") return { allowed: false as const, code: "WRITE_DISABLED", message: "Read-Only" };
      return { allowed: true as const, tool };
    } };
    const { u, c, m, r } = await setup("hanya baca interface");
    let ensured = 0;
    const events: RunEvent[] = [];
    const out = await loopWith(catalog, readOnlyDispatcher as never).run({
      runId: r.id, userId: u.id, conversationId: c.id, userMessageId: m.id, connectionId: "conn-1",
      userText: "hanya baca interface",
      policy: { userId: u.id, connectionId: "conn-1", mode: "read-only", connectorMode: "write", runMode: "read-only", modeVersion: 2, transactionState: "none" },
      client: scripted([
        { calls: [{ id: "w1", name: "mt_set_identity", argumentsJson: '{"name":"X"}' }] },
        { calls: [{ id: "r1", name: "mt_list_ip_addresses", argumentsJson: "{}" }] },
        { text: "Tulis ditolak, baca berhasil." },
      ]),
      systemInstruction: "s",
      ensureTransaction: async () => { ensured += 1; return { ok: true, transactionId: "tx" }; },
      executeTool: async () => ({ ok: true, output: "data" }),
    }, async (e) => { events.push(e); });
    expect(out.status).toBe("completed");
    expect(ensured).toBe(0);
    expect(events.find((e) => e.type === "tool.failed")?.payload).toMatchObject({ code: "WRITE_DISABLED" });
    expect(events.filter((e) => e.type === "tool.completed").length).toBe(1);
  });
});

describe("telemetri antrean + resume", () => {
  test("tunggu limiter dilaporkan via provider.waiting + usage", async () => {
    const { u, c, m, r } = await setup();
    const events: RunEvent[] = [];
    const client: ChatClient = {
      modelLabel: "s",
      async *stream(input) {
        input.onQueueWait?.(2000);
        yield { type: "text", text: "Halo!" };
        yield { type: "done", finishReason: "stop" };
      },
    };
    const out = await loopWith([]).run({
      runId: r.id, userId: u.id, conversationId: c.id, userMessageId: m.id, connectionId: null,
      userText: "halo", policy: { userId: u.id, connectionId: "none", mode: "read-only", modeVersion: 0, transactionState: "none" },
      client, systemInstruction: "s", executeTool: async () => ({ ok: true, output: "x" }),
    }, async (e) => { events.push(e); });
    expect(out.status).toBe("completed");
    expect(events.find((e) => e.type === "provider.waiting")?.payload).toMatchObject({ waitedMs: 2000 });
    const [run] = await db.select().from(agentRuns).where(eq(agentRuns.id, r.id));
    expect(run?.usage as Record<string, unknown>).toMatchObject({ queueMsTotal: 2000, queueWaits: 1 });
  });

  test("lanjutkan memakai ringkasan baca run sebelumnya tanpa mengulang", async () => {
    const [u] = await db.insert(workspaces).values({ name: "resume" }).returning();
    const [c] = await db.insert(conversations).values({ userId: u!.id, title: "t" }).returning();
    await db.insert(messages).values({ conversationId: c!.id, role: "user", content: { text: "cek" }, seq: 1 });
    const [oldRun] = await db.insert(agentRuns).values({ conversationId: c!.id, userId: u!.id, status: "failed" }).returning();
    await db.insert(toolExecutions).values({ runId: oldRun!.id, toolCallId: "old-1", toolName: "mt:list_ip_addresses", risk: "read", sanitizedInput: {}, resultSummary: "10.0.0.1/24 via ether1", status: "completed", durationMs: 5 });
    const [m2] = await db.insert(messages).values({ conversationId: c!.id, role: "user", content: { text: "Lanjutkan pemeriksaan yang belum selesai." }, seq: 2 }).returning();
    const [r2] = await db.insert(agentRuns).values({ conversationId: c!.id, userId: u!.id, status: "queued" }).returning();
    let seenMessages: unknown[] = [];
    const client: ChatClient = {
      modelLabel: "s",
      async *stream(input) {
        seenMessages = input.messages;
        yield { type: "text", text: "Melanjutkan." };
        yield { type: "done", finishReason: "stop" };
      },
    };
    const out = await loopWith([readTool()]).run({
      runId: r2!.id, userId: u!.id, conversationId: c!.id, userMessageId: m2!.id, connectionId: "conn-1",
      userText: "Lanjutkan pemeriksaan yang belum selesai.",
      policy: { userId: u!.id, connectionId: "conn-1", mode: "read-only", modeVersion: 1, transactionState: "none" },
      client, systemInstruction: "s", executeTool: async () => ({ ok: true, output: "x" }),
    }, async () => {});
    expect(out.status).toBe("completed");
    const dump = JSON.stringify(seenMessages);
    expect(dump).toContain("10.0.0.1/24");
    expect(dump).toContain("jangan diulang");
  });
});

describe("benchmark lab: 6 pembacaan batch tanpa discovery", () => {
  test("6 read independen segiliran → 2 request AI, 0 discovery", async () => {
    const reads = ["list_interfaces", "list_ip_addresses", "list_routes", "get_dhcp_clients", "list_firewall_nat", "list_firewall_rules"];
    const catalog = [...reads.map((r) => readTool(`mt:${r}`, r)), findTool()];
    const { u, c, m, r } = await setup();
    let discoveries = 0;
    const out = await loopWith(catalog).run({
      runId: r.id, userId: u.id, conversationId: c.id, userMessageId: m.id, connectionId: "conn-1",
      userText: "periksa interface, ip, route, dhcp client, nat, firewall",
      policy: { userId: u.id, connectionId: "conn-1", mode: "read-only", modeVersion: 1, transactionState: "none" },
      client: scripted([
        { text: "Saya akan memeriksa keenam bagian tersebut.", calls: reads.map((name, i) => ({ id: `b${i}`, name: name.replace(/:/g, "_").replace(/^/, "mt_"), argumentsJson: "{}" })) },
        { text: "Semua terbaca: 4 interface running, 3 IP, 2 route, DHCP ok, 1 NAT, 5 filter." },
      ]),
      systemInstruction: "s",
      executeTool: async ({ fqName }) => {
        if (fqName.includes("find_tools")) discoveries += 1;
        return { ok: true, output: `data ${fqName}` };
      },
    }, async () => {});
    expect(out.status).toBe("completed");
    expect(discoveries).toBe(0);
    const [run] = await db.select().from(agentRuns).where(eq(agentRuns.id, r.id));
    const usage = run?.usage as { aiRequests?: number; toolCalls?: number };
    expect(usage.toolCalls).toBe(6);
    // Target evaluasi: ~2 request model untuk 6 pembacaan batch (bukan 9 seperti run lab lama).
    expect(usage.aiRequests).toBeLessThanOrEqual(3);
  });
});

describe("akar 400 live: argumen parsial disanitasi sebelum digaungkan", () => {
  test("sanitizeToolArguments: hanya objek JSON valid yang diteruskan", async () => {
    const { sanitizeToolArguments } = await import("./chat-client");
    expect(sanitizeToolArguments('{"a":1}')).toBe('{"a":1}');
    expect(sanitizeToolArguments('{"query":"safe mo')).toBe("{}");
    expect(sanitizeToolArguments("")).toBe("{}");
    expect(sanitizeToolArguments("[1,2]")).toBe("{}");
    expect(sanitizeToolArguments("null")).toBe("{}");
  });

  test("buildProviderMessages menggaungkan panggilan rusak sebagai {}", async () => {
    const { buildProviderMessages } = await import("./chat-client");
    const wire = buildProviderMessages([
      { role: "system", content: "s" },
      { role: "user", content: "cek" },
      { role: "assistant", content: "", toolCalls: [{ id: "c1", name: "mt_export_section", argumentsJson: '{"section":"ip fire' }] },
      { role: "tool", content: '{"error":"VALIDATION_FAILED"}', toolCallId: "c1" },
    ], "gemini");
    const asst = wire.find((m) => m.role === "assistant" && m.tool_calls);
    expect(asst?.tool_calls?.[0]?.function.arguments).toBe("{}");
  });

  test("skenario live: tool parsial → request lanjutan valid → run selesai", async () => {
    const bodies: Record<string, unknown>[] = [];
    let hits = 0;
    const partial = '{"section":"ip fire';
    const server = Bun.serve({
      port: 0, hostname: "127.0.0.1",
      async fetch(req) {
        const body = (await req.json()) as Record<string, unknown>;
        bodies.push(body);
        hits += 1;
        if (hits === 1) {
          return new Response(
            `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: "c1", type: "function", function: { name: "mt_export_section", arguments: partial } }] }, finish_reason: null }] })}\n\n` +
            `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "tool_calls" }] })}\n\ndata: [DONE]\n\n`,
            { headers: { "Content-Type": "text/event-stream" } },
          );
        }
        return new Response(
          `data: ${JSON.stringify({ choices: [{ delta: { content: "Argumen kurang, saya ulangi dengan benar." }, finish_reason: null }] })}\n\n` +
          `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`,
          { headers: { "Content-Type": "text/event-stream" } },
        );
      },
    });
    try {
      const client = createOpenAiCompatibleClient(
        { kind: "gemini", baseUrl: `http://127.0.0.1:${server.port}/v1`, model: "gemini-3.5-flash-lite", apiKey: "k-12345678" },
        silentLogger, { limiter: new CentralRateLimiter() },
      );
      const { u, c, m, r } = await setup();
      const catalog = [readTool("mt:export_section", "export_section")];
      const out = await loopWith(catalog).run({
        runId: r.id, userId: u.id, conversationId: c.id, userMessageId: m.id, connectionId: "conn-1",
        userText: "export firewall", policy: { userId: u.id, connectionId: "conn-1", mode: "read-only", modeVersion: 1, transactionState: "none" },
        client, systemInstruction: "s", executeTool: async () => ({ ok: true, output: "x" }),
      }, async () => {});
      // Argumen parsial tidak dieksekusi, request lanjutan tetap valid → selesai.
      expect(hits).toBe(2);
      const req2 = bodies[1] as { messages: { role: string; tool_calls?: { function: { arguments: string } }[] }[] };
      const asst = req2.messages.find((x) => x.role === "assistant" && x.tool_calls);
      expect(asst?.tool_calls?.[0]?.function.arguments).toBe("{}");
      expect(out.status).toBe("completed");
      const rows = await db.select().from(toolExecutions).where(eq(toolExecutions.runId, r.id));
      expect(rows[0]?.status).toBe("rejected");
      expect(rows[0]?.errorCode).toBe("VALIDATION_FAILED");
    } finally { server.stop(); }
  });
});

describe("gateway inner karangan ditolak sebelum eksekusi", () => {
  test("invoke_tool dengan inner tak dikenal → denied TOOL_UNSUPPORTED, nol eksekusi", async () => {
    const gateway: NormalizedTool = { fqName: "mt:invoke_tool", rawName: "invoke_tool", origin: "upstream-mikrotik", risk: "write", classificationProvenance: "upstream-annotation", capabilities: [], inputSchema: { type: "object", properties: {} }, description: "gateway", isGateway: true };
    const catalog = [gateway, readTool("mt:run_routeros_command", "run_routeros_command")];
    const { PolicyDispatcher } = await import("../policies/dispatcher");
    const dispatcher = new PolicyDispatcher({
      modeSource: { getMode: async () => ({ mode: "write", version: 1 }) },
      catalog: { getCatalog: async () => catalog },
      validator: { validate: () => ({ ok: true }) },
      audit() {},
    });
    const { u, c, m, r } = await setup();
    let executed = 0;
    const events: RunEvent[] = [];
    const out = await createAgentLoop({ db, logger: silentLogger, dispatcher: dispatcher as never,
      txCoordinator: coordinatorStub as never, catalog: { getCatalog: async () => catalog },
      limits: { maxSteps: 4, maxToolCalls: 6, runTimeoutMs: 10000, maxTokens: 200 } }).run({
      runId: r.id, userId: u.id, conversationId: c.id, userMessageId: m.id, connectionId: "conn-1",
      userText: "cek", policy: { userId: u.id, connectionId: "conn-1", mode: "write", modeVersion: 1, transactionState: "active" },
      client: scripted([
        { calls: [{ id: "g1", name: "mt_invoke_tool", argumentsJson: '{"name":"mt_run_routeros_command","arguments":{"command":"/ip address print"}}' }] },
        { text: "Nama salah, saya pakai tool langsung." },
      ]),
      systemInstruction: "s",
      executeTool: async () => { executed += 1; return { ok: true, output: "x" }; },
    }, async (e) => { events.push(e); });
    expect(executed).toBe(0);
    expect(events.find((e) => e.type === "tool.failed")?.payload).toMatchObject({ code: "TOOL_UNSUPPORTED" });
    expect(out.status).toBe("completed");
  });
});

describe("payload HTTP palsu: batch, 500, pesan gagal dikecualikan", () => {
  function sse(parts: string[]) { return parts.join(""); }
  function toolChunk(idx: number, id: string, name: string, args: string) {
    return `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: idx, id, type: "function", function: { name, arguments: args } }] }, finish_reason: null }] })}\n\n`;
  }
  function toolEnd() { return `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "tool_calls" }] })}\n\ndata: [DONE]\n\n`; }
  function textEnd(t: string) { return `data: ${JSON.stringify({ choices: [{ delta: { content: t }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`; }

  test("batch 2 tool: request kedua membawa 2 hasil berpasangan, content string", async () => {
    const bodies: Record<string, unknown>[] = [];
    let hits = 0;
    const server = Bun.serve({
      port: 0, hostname: "127.0.0.1",
      async fetch(req) {
        const body = (await req.json()) as Record<string, unknown>;
        bodies.push(body);
        hits += 1;
        if (hits === 1) return new Response(sse([toolChunk(0, "a1", "mt_list_ip_addresses", "{}"), toolChunk(1, "a2", "mt_list_routes", "{}"), toolEnd()]), { headers: { "Content-Type": "text/event-stream" } });
        return new Response(textEnd("Selesai membaca keduanya."), { headers: { "Content-Type": "text/event-stream" } });
      },
    });
    try {
      const client = createOpenAiCompatibleClient(
        { kind: "custom", baseUrl: `http://127.0.0.1:${server.port}/v1`, model: "fake", apiKey: "k-12345678" },
        silentLogger, { limiter: new CentralRateLimiter() },
      );
      const { u, c, m, r } = await setup();
      const catalog = [readTool(), readTool("mt:list_routes", "list_routes")];
      const out = await loopWith(catalog).run({
        runId: r.id, userId: u.id, conversationId: c.id, userMessageId: m.id, connectionId: "conn-1",
        userText: "cek ip dan route", policy: { userId: u.id, connectionId: "conn-1", mode: "read-only", modeVersion: 1, transactionState: "none" },
        client, systemInstruction: "s", executeTool: async () => ({ ok: true, output: "data" }),
      }, async () => {});
      expect(out.status).toBe("completed");
      expect(hits).toBe(2);
      const req2 = bodies[1] as { messages: { role: string; content: unknown; tool_calls?: { id: string }[]; tool_call_id?: string }[] };
      const asst = req2.messages.find((x) => x.role === "assistant" && x.tool_calls);
      expect(typeof asst?.content).toBe("string");
      expect(asst?.tool_calls?.map((x) => x.id).sort()).toEqual(["a1", "a2"]);
      const tools = req2.messages.filter((x) => x.role === "tool");
      expect(tools.map((x) => x.tool_call_id).sort()).toEqual(["a1", "a2"]);
    } finally { server.stop(); }
  });

  test("provider 500 → tepat 1 hit, run failed tanpa retry membabi buta", async () => {
    let hits = 0;
    const server = Bun.serve({
      port: 0, hostname: "127.0.0.1",
      async fetch() { hits += 1; return new Response(JSON.stringify({ error: { message: "boom", code: 500 } }), { status: 500 }); },
    });
    try {
      const client = createOpenAiCompatibleClient(
        { kind: "custom", baseUrl: `http://127.0.0.1:${server.port}/v1`, model: "fake", apiKey: "k-12345678" },
        silentLogger, { limiter: new CentralRateLimiter() },
      );
      const { u, c, m, r } = await setup();
      const events: RunEvent[] = [];
      const out = await loopWith([]).run({
        runId: r.id, userId: u.id, conversationId: c.id, userMessageId: m.id, connectionId: null,
        userText: "halo, apa kabar", policy: { userId: u.id, connectionId: "none", mode: "read-only", modeVersion: 0, transactionState: "none" },
        client, systemInstruction: "s", executeTool: async () => ({ ok: true, output: "x" }),
      }, async (e) => { events.push(e); });
      expect(hits).toBe(1);
      expect(out.status).toBe("failed");
      expect(events.at(-1)?.type).toBe("run.failed");
    } finally { server.stop(); }
  });

  test("riwayat asisten gagal tidak mencemari konteks run baru", async () => {
    const [u] = await db.insert(workspaces).values({ name: "h" }).returning();
    const [c] = await db.insert(conversations).values({ userId: u!.id, title: "t" }).returning();
    await db.insert(messages).values({ conversationId: c!.id, role: "user", content: { text: "cek" }, status: "complete", seq: 1 });
    await db.insert(messages).values({ conversationId: c!.id, role: "assistant", content: { text: "Rate limit 429, saya juga dibatasi." }, status: "failed", seq: 2 });
    const [m3] = await db.insert(messages).values({ conversationId: c!.id, role: "user", content: { text: "coba lagi" }, status: "complete", seq: 3 }).returning();
    const [r] = await db.insert(agentRuns).values({ conversationId: c!.id, userId: u!.id, status: "queued" }).returning();
    let seen = "";
    const client: ChatClient = {
      modelLabel: "s",
      async *stream(input) {
        seen = JSON.stringify(input.messages);
        yield { type: "text", text: "ok" };
        yield { type: "done", finishReason: "stop" };
      },
    };
    await loopWith([]).run({
      runId: r!.id, userId: u!.id, conversationId: c!.id, userMessageId: m3!.id, connectionId: null,
      userText: "coba lagi", policy: { userId: u!.id, connectionId: "none", mode: "read-only", modeVersion: 0, transactionState: "none" },
      client, systemInstruction: "s", executeTool: async () => ({ ok: true, output: "x" }),
    }, async () => {});
    expect(seen).not.toContain("saya juga dibatasi");
  });
});

describe("settlement gagal hanya menandai pesan run terkait", () => {
  test("jawaban lama tetap complete saat commit run baru gagal", async () => {
    const ldb = createDb(":memory:");
    const [user] = await ldb.insert(workspaces).values({ name: "settle" }).returning();
    const [conn] = await ldb.insert(routerConnections).values({ userId: user!.id, label: "r", host: "192.168.88.1", port: 22, username: "a", status: "connected", routerIdentity: "CHR" }).returning();
    const [conv] = await ldb.insert(conversations).values({ userId: user!.id, activeConnectionId: conn!.id }).returning();
    await ldb.insert(messages).values({ conversationId: conv!.id, role: "user", content: { text: "halo" }, status: "complete", seq: 1 });
    await ldb.insert(messages).values({ conversationId: conv!.id, role: "assistant", content: { text: "Jawaban lama yang benar.", runId: "old-run" }, status: "complete", seq: 2 });
    const coordinator = new TransactionCoordinator({
      db: ldb, logger: silentLogger, maxActionsPerTransaction: 10,
      openSession: async () => {
        let w: "active" | "closed" = "closed";
        return {
          enable: async () => { w = "active"; },
          commit: async () => { w = "closed"; },
          rollback: async () => { w = "closed"; },
          status: async () => w,
        };
      },
      verifyChecks: async () => ({ ok: true, detail: "ok" }),
    });
    const txs: StubTransactions = {
      begin: async (a) => coordinator.begin(a),
      commit: async () => { throw new Error("commit unavailable"); },
      rollback: async (id, uid, meta) => coordinator.rollback(id, uid, meta),
      getActionCount: (id) => coordinator.getActionCount(id),
    };
    const catalog = normalizeUpstreamTools([{ name: "set_identity", annotations: { readOnlyHint: false }, inputSchema: { type: "object" } }], [], "upstream-mikrotik", "mt");
    const catalogSource = { getCatalog: async () => catalog };
    const realLoop = createAgentLoop({ db: ldb, logger: silentLogger, txCoordinator: coordinator, catalog: catalogSource,
      dispatcher: new PolicyDispatcher({ modeSource: { getMode: async () => ({ mode: "write", version: 2 }) }, catalog: catalogSource, validator: { validate: () => ({ ok: true }) }, audit() {} }),
      limits: { maxSteps: 3, maxToolCalls: 3, runTimeoutMs: 5000, maxTokens: 100 } });
    let turn = 0;
    const app = buildTestChatApp(ldb, silentLogger, {
      runRateLimit: { maxRuns: 10, windowMs: 60000 }, loop: realLoop, transactions: txs,
      client: { modelLabel: "s", async *stream() {
        if (turn++ === 0) yield { type: "tool_calls", toolCalls: [{ id: "w1", name: "mt_set_identity", argumentsJson: '{"name":"X"}' }] };
        else yield { type: "text", text: "Selesai." };
        yield { type: "done" };
      } },
      executeTool: async () => ({ ok: true, output: "ok" }),
      connectors: {
        getMode: async () => ({ mode: "write", version: 2 }),
        requireOwned: () => async () => conn!,
        decryptCredential: async () => "secret",
      },
    });
    const res = await app.call("POST", `/api/conversations/${conv!.id}/runs`, user!.id, { text: "ubah identity", idempotencyKey: crypto.randomUUID() });
    expect(res.status).toBe(201);
    for (let i = 0; i < 200 && !app.hub.replayUpTo(res.body.runId as string).some((e) => e.type === "run.failed"); i++) await Bun.sleep(10);
    const rows = await ldb.select().from(messages).where(eq(messages.conversationId, conv!.id)).orderBy(desc(messages.seq));
    const oldAnswer = rows.find((x) => (x.content as { runId?: string })?.runId === "old-run");
    expect(oldAnswer?.status).toBe("complete");
    const [run] = await ldb.select().from(agentRuns).where(eq(agentRuns.id, res.body.runId as string));
    expect(run?.status).toBe("failed");
  });
});
