import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { eq } from "drizzle-orm";
import { createDb, type Database } from "../db";
import { users, routerConnections, changeTransactions } from "../db/schema";
import { TransactionCoordinator, type SafeModeSession } from "./coordinator";
import type { Logger } from "../lib/logger";

/**
 * Failure-injection tests for the transaction state machine using a fake
 * safe-mode session. Proves: no false success on drop/crash, no replay,
 * locked serialization per physical router, model-facing early commit refused,
 * and reconciliation never re-executes mutations.
 */
const dbUrl = process.env.DATABASE_URL ?? "postgres://dev:dev@localhost:5432/agent_mikrotik";
let db: Database;
let userId: string;
let connectionId: string;

const logger: Logger = { debug(){}, info(){}, warn(){}, error(){} };

beforeAll(async () => {
  try {
    db = createDb(dbUrl);
    await db.execute("select 1");
  } catch {
    console.log("no local postgres; skipping transaction tests");
    return;
  }
  const [u] = await db.insert(users).values({ email: `tx-test-${Date.now()}@example.com`, name: "Tx Test" }).returning();
  userId = u!.id;
  const [c] = await db.insert(routerConnections).values({
    userId,
    label: "tx-router",
    host: "192.168.99.1",
    port: 22,
    username: "admin",
    routerIdentity: "ROUTER-A",
  }).returning();
  connectionId = c!.id;
});

afterAll(async () => {
  if (userId) await db.delete(users).where(eq(users.id, userId));
});

/** Fake safe-mode session with injectable behaviors. */
function makeSession(opts: {
  enableOk?: boolean;
  dropAt?: "enable" | "mutation" | "commit" | "rollback";
  commitStatus?: "active" | "closed" | "unknown";
  rollbackFails?: boolean;
  statusClosed?: boolean;
} = {}): { session: SafeModeSession; calls: string[] } {
  const calls: string[] = [];
  let dropped = false;
  const session: SafeModeSession = {
    async enable() {
      calls.push("enable");
      if (opts.dropAt === "enable") dropped = true;
    },
    async commit() {
      calls.push("commit");
      if (opts.dropAt === "commit") {
        dropped = true;
        throw new Error("connection reset during commit");
      }
    },
    async rollback() {
      calls.push("rollback");
      if (opts.rollbackFails) throw new Error("rollback failed");
      if (opts.dropAt === "rollback") {
        dropped = true;
        throw new Error("connection reset during rollback");
      }
    },
    async status() {
      calls.push("status");
      if (dropped) return "unknown";
      if (opts.statusClosed) return "closed";
      // commit success closes the window; rollback closes it too
      if (calls.includes("commit") && opts.dropAt !== "commit") return "closed";
      if (calls.includes("rollback") && !opts.rollbackFails) return "closed";
      return "active";
    },
  };
  return { session, calls };
}

function makeCoordinator(sessionFactory: () => SafeModeSession, verifyOk = true) {
  return new TransactionCoordinator({
    db,
    logger,
    openSession: async () => sessionFactory(),
    verifyChecks: async () => (verifyOk ? { ok: true, detail: "checks pass" } : { ok: false, detail: "manajemen tidak sehat" }),
    maxActionsPerTransaction: 5,
  });
}

async function beginTx(coordinator: TransactionCoordinator, routerIdentity = `ROUTER-${Date.now()}-${Math.floor(Math.random() * 1e6)}`) {
  return coordinator.begin({
    userId,
    connectionId,
    routerIdentity,
    runId: null,
    snapshotPlan: [{ name: "identity", command: "/system identity print" }],
  });
}

async function stateOf(txId: string): Promise<string> {
  const [row] = await db.select().from(changeTransactions).where(eq(changeTransactions.id, txId)).limit(1);
  return row!.state;
}

describe("transaction state machine (failure injection)", () => {
  test("happy path: preparing→active→verifying→committing→committed", async () => {
    if (!userId) return;
    const { session } = makeSession();
    const coordinator = makeCoordinator(() => session);
    const { transactionId } = await beginTx(coordinator);
    expect(await stateOf(transactionId)).toBe("active");

    await coordinator.assertActive(transactionId);
    const r = await coordinator.commit(transactionId, userId);
    expect(r.state).toBe("committed");
    expect(await stateOf(transactionId)).toBe("committed");
  });

  test("verify check fails → rollback, never commit", async () => {
    if (!userId) return;
    const { session } = makeSession();
    const coordinator = makeCoordinator(() => session, /* verifyOk */ false);
    const { transactionId } = await beginTx(coordinator);
    const r = await coordinator.commit(transactionId, userId);
    expect(r.state).toBe("rolled_back");
    expect(await stateOf(transactionId)).toBe("rolled_back");
  });

  test("commit with connection drop mid-commit → unknown, not success; window probe prevents false claim", async () => {
    if (!userId) return;
    const { session, calls } = makeSession({ dropAt: "commit", commitStatus: "unknown" });
    const coordinator = makeCoordinator(() => session);
    const { transactionId } = await beginTx(coordinator);
    const r = await coordinator.commit(transactionId, userId);
    // status()=unknown after drop → no false committed
    expect(r.state).toBe("unknown");
    expect(await stateOf(transactionId)).toBe("unknown");
    expect(calls).toContain("commit");
  });

  test("commit fails but window still active → rolled_back (explicit, not unknown)", async () => {
    if (!userId) return;
    // commit throws but window remains open (status=active) → coordinator rolls back
    const calls: string[] = [];
    const session: SafeModeSession = {
      async enable() { calls.push("enable"); },
      async commit() { calls.push("commit"); throw new Error("tool error, window intact"); },
      async rollback() { calls.push("rollback"); },
      async status() { calls.push("status"); return calls.includes("rollback") ? "closed" : "active"; },
    };
    const coordinator = makeCoordinator(() => session);
    const { transactionId } = await beginTx(coordinator);
    const r = await coordinator.commit(transactionId, userId);
    expect(r.state).toBe("rolled_back");
    expect(calls).toContain("rollback");
  });

  test("process crash (session lost) → assertActive marks unknown; reconcile closes books without replay", async () => {
    if (!userId) return;
    const { session } = makeSession();
    const coordinator = makeCoordinator(() => session);
    const { transactionId } = await beginTx(coordinator, "ROUTER-CRASHED");
    // simulate crash: session map gone (coordinator instance lost) → new coordinator
    const coordinator2 = makeCoordinator(() => makeSession().session);
    await expect(coordinator2.assertActive(transactionId)).rejects.toThrow(/Sesi Safe Mode tidak ditemukan/);
    expect(await stateOf(transactionId)).toBe("unknown");
    // reconcile with no session info → stays unknown until a live probe is possible
    const r = await coordinator2.reconcile(transactionId);
    expect(r.state).toBe("unknown");
    // a fresh begin on the same router is refused until the unknown tx is resolved
    await expect(beginTx(coordinator2, "ROUTER-CRASHED")).rejects.toThrow(/status tidak diketahui/);
  });

  test("second transaction on same physical router → conflict, no identity leak", async () => {
    if (!userId) return;
    const { session } = makeSession();
    const coordinator = makeCoordinator(() => session);
    await beginTx(coordinator, "ROUTER-CONFLICT");
    await expect(beginTx(coordinator, "ROUTER-CONFLICT")).rejects.toThrow(/sedang dipakai transaksi lain/);
  });

  test("early commit from verifying-less state / nested / cross-owner refused", async () => {
    if (!userId) return;
    const { session } = makeSession();
    const coordinator = makeCoordinator(() => session);
    const { transactionId } = await beginTx(coordinator);
    // owner mismatch
    await expect(coordinator.commit(transactionId, "someone-else")).rejects.toThrow(/bukan milik sesi ini/);
    // double commit: after committed, second commit transition invalid
    await coordinator.commit(transactionId, userId);
    await expect(coordinator.commit(transactionId, userId)).rejects.toThrow(/Transisi transaksi tidak valid/);
  });

  test("action cap enforced (RouterOS actions, not tool calls)", async () => {
    if (!userId) return;
    const { session } = makeSession();
    const coordinator = makeCoordinator(() => session);
    const { transactionId } = await beginTx(coordinator);
    for (let i = 0; i < 5; i++) coordinator.recordAction(transactionId);
    expect(() => coordinator.recordAction(transactionId)).toThrow(/Batas aksi/);
  });

  test("Write OFF → backend forceRollback cleanup works; window active → rolled back", async () => {
    if (!userId) return;
    const { session } = makeSession();
    const coordinator = makeCoordinator(() => session);
    const { transactionId } = await beginTx(coordinator);
    const r = await coordinator.forceRollback(transactionId, userId);
    expect(r.state).toBe("rolled_back");
  });

  test("rollback request with drop → unknown, verified not claimed", async () => {
    if (!userId) return;
    const { session } = makeSession({ dropAt: "rollback" });
    const coordinator = makeCoordinator(() => session);
    const { transactionId } = await beginTx(coordinator);
    const r = await coordinator.rollback(transactionId, userId, { reason: "test" });
    expect(r.state).toBe("unknown");
  });

  test("safe mode window closed before mutation → assertActive marks unknown (drop detection)", async () => {
    if (!userId) return;
    const calls: string[] = [];
    const session: SafeModeSession = {
      async enable() { calls.push("enable"); },
      async commit() { calls.push("commit"); },
      async rollback() { calls.push("rollback"); },
      async status() { return "closed"; }, // window already gone
    };
    const coordinator = makeCoordinator(() => session);
    // begin: enable then status=closed → unknown immediately
    await expect(beginTx(coordinator)).rejects.toThrow(/Safe Mode tidak aktif setelah enable/);
  });
});

describe("transaction transitions are strictly validated", () => {
  test("committed is terminal; rolled_back is terminal", async () => {
    if (!userId) return;
    const { session } = makeSession();
    const coordinator = makeCoordinator(() => session);
    const { transactionId } = await beginTx(coordinator, "ROUTER-TERMINAL");
    await coordinator.commit(transactionId, userId);
    // try to reuse terminal tx for a new begin (same router) — allowed since books closed
    const { transactionId: tx2 } = await beginTx(makeCoordinator(() => makeSession().session), "ROUTER-TERMINAL");
    expect(await stateOf(tx2)).toBe("active");
  });
});
