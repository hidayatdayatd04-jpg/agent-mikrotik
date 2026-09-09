import type { Hono } from "hono";
import { and, eq, isNull, lt, ne, or } from "drizzle-orm";
import type { Env } from "../../types";
import { attachments } from "../../db/schema";
import { requireWorkspace } from "../../middleware/session";
import { requireConversationOwned, requireStorage, type AttachmentRouteDeps } from "./helpers";

/** Daftar, batas, dan sapu orphan. */
export function registerListingRoutes(
  routes: Hono<Env>,
  deps: AttachmentRouteDeps & { limits: { maxBytes: number; maxFilesPerMessage: number } },
) {
  /** Effective limits for the UI. */
  routes.get("/limits", (c) => {
    requireWorkspace(c);
    return c.json({
      maxBytes: deps.limits.maxBytes,
      maxFilesPerMessage: deps.limits.maxFilesPerMessage,
      accepted: ["png", "jpg", "jpeg", "webp", "pdf", "txt", "csv", "log", "rsc"],
    });
  });

  /** List attachments of a conversation (owner only). */
  routes.get("/:conversationId/files", async (c) => {
    const s = requireWorkspace(c);
    const conversationId = c.req.param("conversationId");
    await requireConversationOwned(deps, s.userId, conversationId);
    const rows = await deps.db
      .select()
      .from(attachments)
      .where(and(eq(attachments.conversationId, conversationId), eq(attachments.userId, s.userId)));
    return c.json({
      attachments: rows.map((r) => ({
        id: r.id,
        originalName: r.originalName,
        contentType: r.contentType,
        sizeBytes: r.sizeBytes,
        status: r.status,
      })),
    });
  });

  /** Orphan sweep: uploading/failed rows older than cutoff with no message bound. */
  routes.post("/cleanup", async (c) => {
    const s = requireWorkspace(c);
    const storage = requireStorage(deps);
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const rows = await deps.db
      .select()
      .from(attachments)
      .where(
        and(
          eq(attachments.userId, s.userId),
          isNull(attachments.messageId),
          lt(attachments.createdAt, cutoff),
          or(ne(attachments.status, "ready"), isNull(attachments.conversationId)),
        ),
      );
    let removed = 0;
    for (const row of rows) {
      await storage.remove(row.objectKey);
      await deps.db.delete(attachments).where(eq(attachments.id, row.id));
      removed += 1;
    }
    return c.json({ removed });
  });
}
