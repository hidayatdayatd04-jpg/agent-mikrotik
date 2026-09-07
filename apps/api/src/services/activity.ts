import { and, asc, desc, eq, gt } from "drizzle-orm";
import type { Database } from "../db";
import { activityEvents } from "../db/schema";
import { redactObject } from "../lib/redaction";

export interface RecordActivityInput {
  conversationId: string;
  runId?: string | null;
  activityId: string;
  parentId?: string | null;
  type: string;
  actor: "user" | "ai" | "system";
  payload: Record<string, unknown>;
}

const MAX_PAYLOAD_CHARS = 12_000;

function sanitizePayload(payload: Record<string, unknown>): Record<string, unknown> {
  const redacted = redactObject(payload) as Record<string, unknown>;
  // Truncate long string fields to bound storage; mark truncated.
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(redacted)) {
    if (typeof v === "string" && v.length > MAX_PAYLOAD_CHARS) {
      out[k] = v.slice(0, MAX_PAYLOAD_CHARS);
      out[`${k}Truncated`] = true;
    } else {
      out[k] = v;
    }
  }
  return out;
}

export async function recordActivity(db: Database, input: RecordActivityInput) {
  const existing = await db
    .select({ seq: activityEvents.seq })
    .from(activityEvents)
    .where(eq(activityEvents.conversationId, input.conversationId))
    .orderBy(desc(activityEvents.seq))
    .limit(1);
  const seq = (existing[0]?.seq ?? 0) + 1;
  const [row] = await db
    .insert(activityEvents)
    .values({
      conversationId: input.conversationId,
      runId: input.runId ?? null,
      activityId: input.activityId,
      parentId: input.parentId ?? null,
      seq,
      type: input.type,
      actor: input.actor,
      payload: sanitizePayload(input.payload),
    })
    .returning();
  return row!;
}

export async function listActivities(
  db: Database,
  conversationId: string,
  opts: { cursor?: number; limit?: number; type?: string } = {},
) {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const after = opts.cursor ?? 0;
  const conds = [eq(activityEvents.conversationId, conversationId), gt(activityEvents.seq, after)];
  if (opts.type) conds.push(eq(activityEvents.type, opts.type));
  const rows = await db
    .select()
    .from(activityEvents)
    .where(and(...conds))
    .orderBy(asc(activityEvents.seq))
    .limit(limit + 1);
  const hasMore = rows.length > limit;
  const items = (hasMore ? rows.slice(0, limit) : rows).map((r) => ({
    id: r.id,
    conversationId: r.conversationId,
    runId: r.runId,
    activityId: r.activityId,
    parentId: r.parentId,
    seq: r.seq,
    type: r.type,
    actor: r.actor,
    payload: r.payload as Record<string, unknown>,
    createdAt: (r.createdAt as Date).toISOString(),
  }));
  const nextCursor = hasMore ? items[items.length - 1]!.seq : null;
  return { events: items, nextCursor };
}
