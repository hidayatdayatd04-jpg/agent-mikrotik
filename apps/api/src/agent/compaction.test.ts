import { describe, expect, test, beforeEach } from "bun:test";
import { createDb, type Database } from "../db";
import { conversations, messages, workspaces } from "../db/schema";
import { startCompaction, latestSummary } from "./compaction";
import type { Logger } from "../lib/logger";
import { eq } from "drizzle-orm";

const silentLogger = { info: () => {}, warn: () => {}, error: () => {}, child: () => silentLogger } as unknown as Logger;
let db: Database;
beforeEach(() => {
  db = createDb(":memory:");
});

function fakeProvider(text: string) {
  return {
    client: {
      modelLabel: "test:fake",
      async *stream() {
        yield { type: "text" as const, text };
        yield { type: "done" as const };
      },
    },
    model: "fake",
    provider: "test",
  };
}

describe("compaction jobs", () => {
  test("manual compact menyimpan summary version + throughSeq; concurrent kedua mengembalikan job sama", async () => {
    const [u] = await db.insert(workspaces).values({ name: "c" }).returning();
    const [conv] = await db.insert(conversations).values({ userId: u!.id, title: "long" }).returning();
    for (let i = 1; i <= 15; i++) {
      await db.insert(messages).values({ conversationId: conv!.id, role: i % 2 ? "user" : "assistant", content: { text: `pesan ${i} tentang router` }, seq: i });
    }
    const deps = { db, logger: silentLogger, getProvider: async () => fakeProvider("Ringkasan: pengguna membahas monitoring.") as never };
    const first = await startCompaction(deps, { userId: u!.id, conversationId: conv!.id, reason: "manual" });
    const second = await startCompaction(deps, { userId: u!.id, conversationId: conv!.id, reason: "manual" });
    expect(second.jobId).toBe(first.jobId);
    // Wait for background job.
    for (let i = 0; i < 50 && !(await latestSummary(db, conv!.id)); i++) await new Promise((r) => setTimeout(r, 20));
    const sum = await latestSummary(db, conv!.id);
    expect(sum?.version).toBe(1);
    expect(sum?.throughSeq).toBeGreaterThan(0);
    // Source messages still intact (no deletion).
    const all = await db.select().from(messages).where(eq(messages.conversationId, conv!.id));
    expect(all.length).toBe(15);
    await db.delete(workspaces).where(eq(workspaces.id, u!.id));
  });

  test("provider belum dikonfigurasi -> job failed jujur, bukan mock sukses", async () => {
    const [u] = await db.insert(workspaces).values({ name: "c2" }).returning();
    const [conv] = await db.insert(conversations).values({ userId: u!.id, title: "long2" }).returning();
    for (let i = 1; i <= 15; i++) {
      await db.insert(messages).values({ conversationId: conv!.id, role: "user", content: { text: `m${i}` }, seq: i });
    }
    const deps = { db, logger: silentLogger, getProvider: async () => null };
    await startCompaction(deps, { userId: u!.id, conversationId: conv!.id, reason: "manual" });
    await new Promise((r) => setTimeout(r, 200));
    expect(await latestSummary(db, conv!.id)).toBeNull();
    await db.delete(workspaces).where(eq(workspaces.id, u!.id));
  });
});
