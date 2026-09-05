import { describe, expect, test, beforeEach } from "bun:test";
import { createDb, type Database } from "../db";
import { buildTestChatApp } from "./test-deps";
import { eq } from "drizzle-orm";
import { conversations, users, attachments } from "../db/schema";
import type { Logger } from "../lib/logger";

/**
 * M10 route tests (local Postgres): run rate limit + conversation delete
 * removes attachment objects from storage before rows cascade.
 */
const dbUrl = process.env.DATABASE_URL ?? "postgres://dev:dev@localhost:5432/agent_mikrotik";

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
    await db.execute("select 1");
    connected = true;
  } catch {
    console.log("no local postgres; skipping chat route tests");
  }
});

describe("chat routes M10 (local postgres)", () => {
  test("run rate limit: the Nth+1 run within the window is rejected 429 RATE_LIMITED", async () => {
    if (!connected) return;
    const app = buildTestChatApp(db, silentLogger, { runRateLimit: { maxRuns: 2, windowMs: 60_000 } });
    const [u] = await db.insert(users).values({ email: `rl-${Date.now()}@example.com`, name: "t" }).returning();
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
    await db.delete(users).where(eq(users.id, u!.id));
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
    const [u] = await db.insert(users).values({ email: `del-${Date.now()}@example.com`, name: "t" }).returning();
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
    await db.delete(users).where(eq(users.id, u!.id));
  });

  test("delete refuses while a run is active (RUN_ALREADY_ACTIVE)", async () => {
    if (!connected) return;
    const app = buildTestChatApp(db, silentLogger, { runRateLimit: { maxRuns: 999, windowMs: 60_000 } });
    const [u] = await db.insert(users).values({ email: `del-run-${Date.now()}@example.com`, name: "t" }).returning();
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
    await db.delete(users).where(eq(users.id, u!.id));
  });
});
