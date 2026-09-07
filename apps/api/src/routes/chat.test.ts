import { describe, expect, test, beforeEach } from "bun:test";
import { createDb, type Database } from "../db";
import { buildTestChatApp, type StubTransactions } from "./test-deps";
import { eq } from "drizzle-orm";
import { conversations, workspaces, attachments } from "../db/schema";
import type { Logger } from "../lib/logger";

/**
 * M10 route tests (SQLite): run rate limit + conversation delete
 * removes attachment objects from storage before rows cascade.
 */
const dbUrl = ":memory:";

let db: Database;
let connected = false;

const silentLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => silentLogger,
} as unknown as Logger;

beforeEach(async () => {
  try {
    if (!db) db = createDb(dbUrl);
    await db.run("select 1");
    connected = true;
  } catch {
    throw new Error("SQLite test setup failed");
  }
});

describe("chat routes M10 (SQLite)", () => {
  test("context usage returns the latest run and enforces conversation ownership", async () => {
    const app = buildTestChatApp(db, silentLogger, { runRateLimit: { maxRuns: 10, windowMs: 60000 } });
    const [u] = await db.insert(workspaces).values({ name: "context" }).returning();
    const [conv] = await db.insert(conversations).values({ userId: u!.id, title: "context" }).returning();
    const { agentRuns } = await import("../db/schema");
    await db.insert(agentRuns).values({ userId: u!.id, conversationId: conv!.id, createdAt: new Date(0), usage: { promptTokens: 99 } });
    const usage = { modelLabel: "openrouter:model", source: "provider", promptTokens: 5000, completionTokens: 120 };
    const [latest] = await db.insert(agentRuns).values({ userId: u!.id, conversationId: conv!.id, status: "completed", usage }).returning();
    const res = await app.call("GET", `/api/conversations/${conv!.id}/context`, u!.id);
    expect(res.body).toEqual({ usage, runId: latest!.id, status: "completed" });
    expect((await app.call("GET", `/api/conversations/${conv!.id}/context`, crypto.randomUUID())).status).toBe(404);
    await db.delete(workspaces).where(eq(workspaces.id, u!.id));
  });

  test("creating a run refreshes activity and moves the conversation to the top", async () => {
    const app = buildTestChatApp(db, silentLogger, { runRateLimit: { maxRuns: 10, windowMs: 60_000 } });
    const [u] = await db.insert(workspaces).values({ name: "activity-test" }).returning();
    const oldTime = new Date("2020-01-01T00:00:00Z");
    const [older] = await db.insert(conversations).values({ userId: u!.id, title: "older", updatedAt: oldTime }).returning();
    await db.insert(conversations).values({ userId: u!.id, title: "newer", updatedAt: new Date("2021-01-01T00:00:00Z") });
    const startedAt = Date.now();
    const res = await app.call("POST", `/api/conversations/${older!.id}/runs`, u!.id, {
      text: "hello", idempotencyKey: crypto.randomUUID(),
    });
    expect(res.status).toBe(201);
    const [updated] = await db.select().from(conversations).where(eq(conversations.id, older!.id));
    expect(updated!.updatedAt.getTime()).toBeGreaterThanOrEqual(startedAt);
    const listing = await app.call("GET", "/api/conversations", u!.id);
    expect((listing.body.conversations as { id: string }[])[0]!.id).toBe(older!.id);
    await db.delete(workspaces).where(eq(workspaces.id, u!.id));
  });

  test("run rate limit: the Nth+1 run within the window is rejected 429 RATE_LIMITED", async () => {
    if (!connected) return;
    const app = buildTestChatApp(db, silentLogger, { runRateLimit: { maxRuns: 2, windowMs: 60_000 } });
    const [u] = await db.insert(workspaces).values({ name: "t" }).returning();
    const [conv] = await db.insert(conversations).values({ userId: u!.id, title: "rl" }).returning();
    const results: { status: number; code?: string }[] = [];
    for (let i = 0; i < 3; i++) {
      const res = await app.call("POST", `/api/conversations/${conv!.id}/runs`, u!.id, {
        text: `pesan ${i}`,
        idempotencyKey: `rl-${Date.now()}-${i}`,
      });
      results.push({ status: res.status, code: res.body.error?.code });
    }
    expect(results[0]?.status).toBe(201);
    expect(results[1]?.status).toBe(201);
    expect(results[2]?.status).toBe(429);
    expect(results[2]?.code).toBe("RATE_LIMITED");
    await db.delete(workspaces).where(eq(workspaces.id, u!.id));
  });

  test("delete conversation removes attachment objects from storage before cascade", async () => {
    if (!connected) return;
    const removed: string[] = [];
    const app = buildTestChatApp(db, silentLogger, {
      runRateLimit: { maxRuns: 999, windowMs: 60_000 },
      removeAttachmentObject: async (input) => {
        removed.push(input.objectKey);
      },
    });
    const [u] = await db.insert(workspaces).values({ name: "t" }).returning();
    const [conv] = await db.insert(conversations).values({ userId: u!.id, title: "del" }).returning();
    const keys = [
      `attachments/${u!.id}/${conv!.id}/obj-a.rsc`,
      `attachments/${u!.id}/${conv!.id}/obj-b.png`,
    ];
    for (const [i, k] of keys.entries()) {
      await db.insert(attachments).values({
        userId: u!.id,
        conversationId: conv!.id,
        objectKey: k,
        originalName: i === 0 ? "a.rsc" : "b.png",
        contentType: i === 0 ? "application/octet-stream" : "image/png",
        sizeBytes: 10 + i,
        status: "ready",
      });
    }
    const res = await app.call("DELETE", `/api/conversations/${conv!.id}`, u!.id);
    expect(res.status).toBe(200);
    expect(res.body.objectsRemoved).toBe(2);
    expect(removed.sort()).toEqual([...keys].sort());
    const left = await db.select().from(attachments).where(eq(attachments.conversationId, conv!.id));
    expect(left.length).toBe(0); // rows cascaded away
    await db.delete(workspaces).where(eq(workspaces.id, u!.id));
  });

  test("delete refuses while a run is active (RUN_ALREADY_ACTIVE)", async () => {
    if (!connected) return;
    const app = buildTestChatApp(db, silentLogger, { runRateLimit: { maxRuns: 999, windowMs: 60_000 } });
    const [u] = await db.insert(workspaces).values({ name: "t" }).returning();
    const [conv] = await db.insert(conversations).values({ userId: u!.id, title: "del-run" }).returning();
    const { agentRuns } = await import("../db/schema");
    await db.insert(agentRuns).values({
      userId: u!.id,
      conversationId: conv!.id,
      status: "running",
      idempotencyKey: `active-${Date.now()}`,
    });
    const res = await app.call("DELETE", `/api/conversations/${conv!.id}`, u!.id);
    expect(res.status).toBe(409);
    expect(res.body.error?.code).toBe("RUN_ALREADY_ACTIVE");
    await db.delete(workspaces).where(eq(workspaces.id, u!.id));
  });

  test("write-mode run auto-begins a safe-mode transaction; read-only run does not", async () => {
    if (!connected) return;
    const began: Parameters<StubTransactions["begin"]>[0][] = [];
    const settled: string[] = [];
    const txStub = {
      begin: async (input: Parameters<StubTransactions["begin"]>[0]) => {
        began.push(input);
        return { transactionId: "tx-1" };
      },
      commit: async (txId: string, _userId: string) => {
        settled.push(`commit:${txId}`);
        return { state: "committed" };
      },
      rollback: async (txId: string, _userId: string, _meta: { reason: string }) => {
        settled.push(`rollback:${txId}`);
        return { state: "rolled_back" };
      },
      getActionCount: (_txId: string) => 0,
    };
    const writeConnectors = {
      getMode: async () => ({ mode: "write" as const, version: 2 }),
      requireOwned: () => async () => ({ routerIdentity: "CHR", host: "h", status: "connected" }),
      decryptCredential: async () => "test-secret",
    };
    const app = buildTestChatApp(db, silentLogger, {
      runRateLimit: { maxRuns: 999, windowMs: 60_000 },
      connectors: writeConnectors,
      transactions: txStub,
    });
    const [u] = await db.insert(workspaces).values({ name: "writetx" }).returning();
    const { routerConnections } = await import("../db/schema");
    const [connRow] = await db
      .insert(routerConnections)
      .values({ userId: u!.id, label: "r", host: "192.168.56.2", port: 22, username: "admin", status: "connected", routerIdentity: "CHR" })
      .returning();
    const [conv] = await db.insert(conversations).values({ userId: u!.id, title: "w", activeConnectionId: connRow!.id }).returning();
    const res = await app.call("POST", `/api/conversations/${conv!.id}/runs`, u!.id, {
      text: "block it",
      idempotencyKey: `w-${Date.now()}`,
    });
    expect(res.status).toBe(201);
    await new Promise((r) => setTimeout(r, 150));
    expect(began.length).toBe(1);
    expect(began[0]?.runId).toBe((res.body as { runId: string }).runId);
    // the stubbed loop records no RouterOS actions → empty tx is rolled back
    expect(settled).toEqual(["rollback:tx-1"]);

    // a read-only run never touches the transaction lifecycle
    began.length = 0;
    settled.length = 0;
    const appRo = buildTestChatApp(db, silentLogger, {
      runRateLimit: { maxRuns: 999, windowMs: 60_000 },
      transactions: txStub,
    });
    const [convRo] = await db.insert(conversations).values({ userId: u!.id, title: "ro" }).returning();
    const resRo = await appRo.call("POST", `/api/conversations/${convRo!.id}/runs`, u!.id, {
      text: "hello",
      idempotencyKey: `ro-${Date.now()}`,
    });
    expect(resRo.status).toBe(201);
    await new Promise((r) => setTimeout(r, 150));
    expect(began.length).toBe(0);
    expect(settled.length).toBe(0);
    await db.delete(workspaces).where(eq(workspaces.id, u!.id));
  });

  test("write-mode run with empty stored credential skips Safe Mode begin (fail fast)", async () => {
    if (!connected) return;
    let began = 0;
    const txStub = {
      begin: async (_input: Parameters<StubTransactions["begin"]>[0]) => {
        began += 1;
        return { transactionId: "tx-ff" };
      },
      commit: async () => ({ state: "committed" }),
      rollback: async () => ({ state: "rolled_back" }),
      getActionCount: () => 0,
    };
    const app = buildTestChatApp(db, silentLogger, {
      runRateLimit: { maxRuns: 999, windowMs: 60_000 },
      connectors: {
        getMode: async () => ({ mode: "write" as const, version: 2 }),
        requireOwned: () => async () => ({ routerIdentity: "CHR", host: "h", status: "connected" }),
        decryptCredential: async () => "",
      },
      transactions: txStub,
    });
    const [u] = await db.insert(workspaces).values({ name: "failfast" }).returning();
    const { routerConnections } = await import("../db/schema");
    const [connRow] = await db
      .insert(routerConnections)
      .values({ userId: u!.id, label: "r", host: "192.168.56.2", port: 22, username: "admin", status: "connected", routerIdentity: "CHR" })
      .returning();
    const [conv] = await db.insert(conversations).values({ userId: u!.id, title: "ff", activeConnectionId: connRow!.id }).returning();
    const res = await app.call("POST", `/api/conversations/${conv!.id}/runs`, u!.id, {
      text: "tambah dns",
      idempotencyKey: `ff-${Date.now()}`,
    });
    expect(res.status).toBe(201);
    await new Promise((r) => setTimeout(r, 150));
    // no Safe Mode attempt at all — the run proceeds read-only with guidance
    expect(began).toBe(0);
    await db.delete(workspaces).where(eq(workspaces.id, u!.id));
  });

  test("cancel finalizes a workerless running run so later sends don't 409", async () => {
    if (!connected) return;
    const app = buildTestChatApp(db, silentLogger, { runRateLimit: { maxRuns: 999, windowMs: 60_000 } });
    const [u] = await db.insert(workspaces).values({ name: "cancel-stuck" }).returning();
    const [conv] = await db.insert(conversations).values({ userId: u!.id, title: "stuck" }).returning();
    const { agentRuns } = await import("../db/schema");
    const [stuck] = await db
      .insert(agentRuns)
      .values({ userId: u!.id, conversationId: conv!.id, status: "running", idempotencyKey: `stuck-${Date.now()}` })
      .returning();
    // noop loop owns no workers → has() is false → endpoint finalizes the row
    const cancelRes = await app.call("POST", `/api/runs/${stuck!.id}/cancel`, u!.id);
    expect(cancelRes.status).toBe(200);
    const [row] = await db.select().from(agentRuns).where(eq(agentRuns.id, stuck!.id));
    expect(row!.status).toBe("cancelled");
    // conversation accepts a new run again
    const res = await app.call("POST", `/api/conversations/${conv!.id}/runs`, u!.id, {
      text: "lanjut",
      idempotencyKey: `after-${Date.now()}`,
    });
    expect(res.status).toBe(201);
    await db.delete(workspaces).where(eq(workspaces.id, u!.id));
  });
});
