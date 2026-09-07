import { describe, expect, test, beforeEach } from "bun:test";
import { createDb, type Database } from "../db";
import { conversations, workspaces } from "../db/schema";
import { recordActivity, listActivities } from "./activity";
import { eq } from "drizzle-orm";

let db: Database;
beforeEach(() => {
  db = createDb(":memory:");
});

describe("activity event store", () => {
  test("seq unik per conversation dan pagination", async () => {
    const [u] = await db.insert(workspaces).values({ name: "a" }).returning();
    const [conv] = await db.insert(conversations).values({ userId: u!.id, title: "c" }).returning();
    for (let i = 0; i < 5; i++) {
      await recordActivity(db, {
        conversationId: conv!.id,
        type: "tool.started",
        actor: "ai",
        activityId: `act-${i}`,
        payload: { tool: "docs:routeros_search", index: i },
      });
    }
    const p1 = await listActivities(db, conv!.id, { limit: 2 });
    expect(p1.events.length).toBe(2);
    expect(p1.events[0]!.seq).toBe(1);
    expect(p1.nextCursor).toBe(2);
    const p2 = await listActivities(db, conv!.id, { cursor: p1.nextCursor!, limit: 10 });
    expect(p2.events[0]!.seq).toBe(3);
    // Redaction applies to stored payload.
    await recordActivity(db, {
      conversationId: conv!.id,
      type: "tool.completed",
      actor: "ai",
      activityId: "secret",
      payload: { tool: "x", password: "hunter2" },
    });
    const all = await listActivities(db, conv!.id, { limit: 20 });
    const last = all.events[all.events.length - 1]!;
    expect(JSON.stringify(last.payload)).not.toContain("hunter2");
    await db.delete(workspaces).where(eq(workspaces.id, u!.id));
  });
});
