import type { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { AppError } from "../../lib/errors";
import type { Env } from "../../types";
import { agentRuns, attachments, conversations } from "../../db/schema";
import { requireConversation, requireWorkspace } from "./helpers";
import type { ChatCtx } from "./types";

/** Hapus percakapan + objek lampiran miliknya (sebelum cascade DB). */
export function registerConversationDelete(routes: Hono<Env>, ctx: ChatCtx) {
  const { deps } = ctx;

  routes.delete("/api/conversations/:id", async (c) => {
    const workspace = requireWorkspace(c);
    const conv = await requireConversation(ctx, workspace.userId, c.req.param("id"));
    // refuse deletion while a run is active on this conversation
    const active = await deps.db
      .select({ id: agentRuns.id })
      .from(agentRuns)
      .where(and(eq(agentRuns.conversationId, conv.id), eq(agentRuns.status, "running")))
      .limit(1);
    if (active.length > 0) {
      throw new AppError("RUN_ALREADY_ACTIVE", "Ada run aktif pada percakapan ini; batalkan dulu.", 409);
    }
    // M10: remove every attachment object owned by this conversation from
    // storage BEFORE dropping the DB rows (cascade would orphan the objects)
    const attRows = await deps.db
      .select({ objectKey: attachments.objectKey })
      .from(attachments)
      .where(and(eq(attachments.conversationId, conv.id), eq(attachments.userId, workspace.userId)));
    for (const row of attRows) {
      await deps.removeAttachmentObject({ userId: workspace.userId, objectKey: row.objectKey });
    }
    await deps.db.delete(conversations).where(eq(conversations.id, conv.id));
    return c.json({ ok: true, objectsRemoved: attRows.length });
  });
}
