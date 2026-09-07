import { PolicyDispatcher } from "../policies/dispatcher";
import { normalizeUpstreamTools } from "../policies/normalize";
import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { createDb } from "../db";
import { agentRuns, changeTransactions, conversations, routerConnections, workspaces } from "../db/schema";
import { buildTestChatApp, type StubTransactions } from "./test-deps";
import { createAgentLoop, type AgentLoop, type StartRunInput } from "../agent/loop";
import { TransactionCoordinator } from "../transactions/coordinator";
import { buildSystemInstruction } from "../agent/instructions";
import type { Logger } from "../lib/logger";

const logger: Logger = { debug() {}, info() {}, warn() {}, error() {} };

async function fixture(opts: { text?: string; status?: "completed" | "failed" | "cancelled"; actions?: number; connected?: boolean; identity?: string | null; credential?: string | null; beginError?: string; commitError?: boolean; alreadyRolledBack?: boolean; realLoop?: boolean } = {}) {
  const db = createDb(":memory:");
  const [user] = await db.insert(workspaces).values({ name: "regression" }).returning();
  const [conn] = await db.insert(routerConnections).values({ userId: user!.id, label: "router", host: "192.168.88.1", port: 22, username: "admin", status: opts.connected === false ? "disconnected" : "connected", routerIdentity: opts.identity === undefined ? "CHR" : opts.identity }).returning();
  const [conv] = await db.insert(conversations).values({ userId: user!.id, activeConnectionId: conn!.id }).returning();
  const began: Parameters<StubTransactions["begin"]>[0][] = [];
  const calls: string[] = [];
  let input: StartRunInput | undefined;
  let window: "active" | "closed" | "unknown" = "closed";
  const coordinator = new TransactionCoordinator({
    db, logger, maxActionsPerTransaction: 10,
    openSession: async () => ({
      enable: async () => { window = "active"; },
      commit: async () => { calls.push("session.commit"); window = "closed"; },
      rollback: async () => { calls.push("session.rollback"); window = "closed"; },
      status: async () => window,
    }),
    verifyChecks: async () => ({ ok: true, detail: "verified" }),
  });
  let txId = "";
  const transactions: StubTransactions = {
    begin: async (args) => {
      if (!args.userId || !args.connectionId || !args.routerIdentity || !args.runId || !args.snapshotPlan.length) throw new Error("Incomplete production begin arguments");
      began.push(args);
      if (opts.beginError) throw new Error(opts.beginError);
      const result = await coordinator.begin(args);
      txId = result.transactionId;
      return result;
    },
    commit: async (id, userId) => {
      calls.push("commit");
      if (opts.commitError) throw new Error("commit unavailable");
      return coordinator.commit(id, userId);
    },
    rollback: async (id, userId, meta) => { calls.push(`rollback:${meta.reason}`); return coordinator.rollback(id, userId, meta); },
    getActionCount: (id) => coordinator.getActionCount(id),
  };
  const loop: AgentLoop = {
    run: async (value, emit) => {
      input = value;
      // Simulasi jalur lazy: loop memanggil ensureTransaction tepat sebelum
      // mutasi pertama (hanya bila policy write). Sapaan/read-only tidak memanggil.
      if ((opts.actions ?? 1) > 0 && value.policy.mode === "write") {
        const ensured = await value.ensureTransaction?.();
        if (ensured?.ok && txId) {
          value.policy.transactionState = "active";
          for (let i = 0; i < (opts.actions ?? 1); i++) coordinator.recordAction(txId);
        }
      }
      if (opts.alreadyRolledBack && txId) await coordinator.forceRollback(txId, user!.id);
      const status = opts.status ?? "completed";
      await emit({ runId: value.runId, seq: 1, type: "run.started", payload: {} });
      await emit({ runId: value.runId, seq: 2, type: `run.${status}`, payload: {} });
      return { status };
    },
    cancel() {}, has: () => false, isCancelled: () => false,
  };
  const catalog = { getCatalog: async () => normalizeUpstreamTools([{ name: "set_identity", annotations: { readOnlyHint: false }, inputSchema: { type: "object" } }], [], "upstream-mikrotik", "mt") };
  const realLoop = createAgentLoop({ db, logger, txCoordinator: coordinator, catalog,
    dispatcher: new PolicyDispatcher({ modeSource: { getMode: async () => ({ mode: "write", version: 2 }) }, catalog, validator: { validate: () => ({ ok: true }) }, audit() {} }),
    limits: { maxSteps: 3, maxToolCalls: 3, runTimeoutMs: 1000, maxTokens: 100 },
  });
  let turn = 0;
  const app = buildTestChatApp(db, logger, {
    runRateLimit: { maxRuns: 10, windowMs: 60000 }, loop: opts.realLoop ? realLoop : loop, transactions,
    client: { modelLabel: "scripted", async *stream() {
      if (turn++ === 0) yield { type: "tool_calls", toolCalls: [{ id: "write-1", name: "mt_set_identity", argumentsJson: '{"name":"X"}' }] };
      else yield { type: "text", text: "Identity diperbarui." };
      yield { type: "done" };
    } },
    executeTool: async () => { expect(window).toBe("active"); calls.push("mutation"); return { ok: true, output: "identity=X" }; },
    connectors: {
      getMode: async () => ({ mode: "write", version: 2 }),
      requireOwned: () => async () => conn!,
      decryptCredential: async () => { if (opts.credential === null) throw new Error("unreadable"); return opts.credential ?? "stored-secret"; },
    },
  });
  const res = await app.call("POST", `/api/conversations/${conv!.id}/runs`, user!.id, { text: opts.text ?? "ubah identity", idempotencyKey: crypto.randomUUID() });
  expect(res.status).toBe(201);
  const runId = res.body.runId as string;
  for (let i = 0; i < 100 && !app.hub.replayUpTo(runId).some(e => ["run.completed", "run.failed", "run.cancelled"].includes(e.type)); i++) await Bun.sleep(5);
  const events = app.hub.replayUpTo(runId);
  expect(events.at(-1)?.type).toMatch(/^run\.(completed|failed|cancelled)$/);
  const [tx] = await db.select().from(changeTransactions).where(eq(changeTransactions.id, txId));
  const [run] = await db.select().from(agentRuns).where(eq(agentRuns.id, runId));
  return { began, calls, input: input!, events, tx, run, user: user!, conn: conn!, runId };
}

test("chat uses all production begin arguments, active policy and commits before terminal SSE", async () => {
  const f = await fixture();
  expect(f.began).toEqual([{ userId: f.user.id, connectionId: f.conn.id, routerIdentity: "CHR", runId: f.runId, snapshotPlan: [{ name: "identity", command: "/system identity print" }] }]);
  // Lazy: policy diotorisasi write sejak awal dengan transactionState none;
  // transaksi dibuka via ensureTransaction tepat sebelum mutasi.
  expect(f.input.policy).toMatchObject({ mode: "write", transactionState: "active" });
  expect(f.input.systemInstruction).toContain("MODE OPERASI: Write");
  expect(f.input.systemInstruction).toContain("otomatis tepat sebelum mutasi pertama");
  expect(f.calls).toEqual(["commit", "session.commit"]);
  expect(f.tx?.state).toBe("committed");
  expect(f.events.map(e => e.type)).toEqual(["run.started", "transaction.updated", "run.completed"]);
  expect(f.events.map(e => e.seq)).toEqual([1, 2, 3]);
  expect(f.events[1]?.payload).toMatchObject({ state: "committed", actions: 1 });
});

test("halo on a connected Write router does not open an empty transaction", async () => {
  const f = await fixture({ text: "halo" });
  expect(f.began).toEqual([]);
  expect(f.calls).toEqual([]);
  expect(f.input.policy).toMatchObject({ mode: "read-only", transactionState: "none" });
  expect(f.events.some((e) => e.type === "transaction.updated")).toBe(false);
});

for (const status of ["failed", "cancelled"] as const) test(`${status} run rolls back production coordinator`, async () => {
  const f = await fixture({ status });
  expect(f.calls).toEqual(["rollback:run gagal/dibatalkan", "session.rollback"]);
  expect(f.tx?.state).toBe("rolled_back");
  expect(f.events[1]?.payload).toMatchObject({ state: "rolled_back" });
});

test("no mutation means no transaction is ever opened (lazy)", async () => {
  const f = await fixture({ actions: 0 });
  expect(f.began).toEqual([]);
  expect(f.calls).toEqual([]);
  expect(f.events.map(e => e.type)).toEqual(["run.started", "run.completed"]);
});

test("commit exception emits unknown and never announces run success", async () => {
  const f = await fixture({ commitError: true });
  expect(f.events[1]?.payload).toMatchObject({ state: "unknown" });
  expect(f.events.at(-1)?.type).toBe("run.failed");
  expect(f.run?.status).toBe("failed");
});

test("Write revoked during run does not settle an already rolled-back transaction twice", async () => {
  const f = await fixture({ alreadyRolledBack: true });
  expect(f.calls).toEqual(["session.rollback"]);
  expect(f.tx?.state).toBe("rolled_back");
  expect(f.events[1]?.payload).toMatchObject({ state: "rolled_back" });
});

for (const opts of [{ connected: false }, { identity: null }, { credential: "" }, { credential: null }]) test(`write pre-check blocks mutation early: ${JSON.stringify(opts)}`, async () => {
  const f = await fixture(opts);
  expect(f.began).toEqual([]);
  expect(f.input.policy).toMatchObject({ mode: "read-only", transactionState: "none" });
  expect(f.input.systemInstruction).not.toContain("transaksi Safe Mode sudah dibuka");
  expect(f.input.systemInstruction).toContain("CATATAN SISTEM");
  expect(f.input.systemInstruction).toContain("Jelaskan keadaan ini dengan jujur");
  if ("connected" in opts) expect(f.input.systemInstruction).toContain("router belum tersambung");
  expect(f.calls).toEqual([]);
});

test("busy router surfaces at lazy begin time; run stays write-authorized", async () => {
  const f = await fixture({ beginError: "Safe Mode router sedang dipakai transaksi lain" });
  // Pre-check sehat → policy write; begin gagal saat ensureTransaction dipanggil loop.
  expect(f.began.length).toBe(1);
  expect(f.input.policy).toMatchObject({ mode: "write" });
  expect(f.calls).toEqual([]);
});

test("write instruction describes lazy Safe Mode opening", () => {
  const instruction = buildSystemInstruction({ mode: "write", routerLabel: "CHR", modelLabel: "test" });
  expect(instruction).not.toContain("transaksi Safe Mode sudah dibuka");
  expect(instruction).toContain("otomatis tepat sebelum mutasi pertama");
});


test("production chat + agent loop + dispatcher + coordinator permits a write and commits its recorded action", async () => {
  const f = await fixture({ realLoop: true });
  expect(f.calls).toEqual(["mutation", "commit", "session.commit"]);
  expect(f.tx?.state).toBe("committed");
  const updates = f.events.filter(e => e.type === "transaction.updated");
  // Lazy open emits active/actions:0, lalu pencatatan aksi mutasi actions:1.
  expect(updates[0]?.payload).toMatchObject({ state: "active", actions: 0 });
  expect(updates.some((u) => (u.payload as { state?: string; actions?: number }).state === "active" && (u.payload as { actions?: number }).actions === 1)).toBe(true);
  expect(updates.at(-1)?.payload).toMatchObject({ state: "committed", actions: 1 });
  expect(f.events.at(-1)?.type).toBe("run.completed");
});
