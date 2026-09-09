import type { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { AppError } from "../../lib/errors";
import type { Env } from "../../types";
import { attachments } from "../../db/schema";
import { requireWorkspace } from "../../middleware/session";
import { detectContentKind } from "../../services/storage";
import { extForName, requireConversationOwned, requireStorage, type AttachmentRouteDeps } from "./helpers";
import type { Logger } from "../../lib/logger";

/** Upload, unduh, hapus file lampiran. */
export function registerFileRoutes(
  routes: Hono<Env>,
  deps: AttachmentRouteDeps & { logger: Logger; limits: { maxBytes: number } },
) {
  /** Upload one file into a conversation. Multipart, streamed with a hard byte cap. */
  routes.post("/:conversationId/files", async (c) => {
    const s = requireWorkspace(c);
    const storage = requireStorage(deps);
    const conversationId = c.req.param("conversationId");
    await requireConversationOwned(deps, s.userId, conversationId);

    const form = await c.req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new AppError("VALIDATION_FAILED", "Field \"file\" wajib berupa file.", 422);
    if (file.size <= 0) throw new AppError("VALIDATION_FAILED", "File kosong.", 422);
    if (file.size > deps.limits.maxBytes) {
      throw new AppError("FILE_TOO_LARGE", `File melebihi batas ${Math.floor(deps.limits.maxBytes / (1024 * 1024))} MiB.`, 413);
    }
    if (file.name.length > 255) throw new AppError("VALIDATION_FAILED", "Nama file terlalu panjang.", 422);

    const mimeType = file.type || "application/octet-stream";
    const buf = Buffer.from(await file.arrayBuffer());
    const sniff = detectContentKind({ mimeType, originalName: file.name, head: buf.subarray(0, 512) });
    if (!sniff.ok) {
      throw new AppError("VALIDATION_FAILED", sniff.reason ?? "Tipe file tidak didukung.", 422);
    }

    const objectKey = storage.buildObjectKey(s.userId, conversationId, extForName(file.name, mimeType));
    const stored = await storage.put({ objectKey, body: buf, contentType: mimeType, contentLength: buf.length });

    const [row] = await deps.db
      .insert(attachments)
      .values({
        userId: s.userId,
        conversationId,
        objectKey,
        originalName: file.name,
        contentType: mimeType,
        sizeBytes: buf.length,
        checksum: stored.checksum,
        status: "ready",
      })
      .returning();
    deps.logger.info("attachment uploaded", { attachmentId: row?.id, conversationId, bytes: buf.length, kind: sniff.kind });
    return c.json({
      attachment: {
        id: row?.id,
        conversationId,
        originalName: row?.originalName,
        contentType: row?.contentType,
        sizeBytes: row?.sizeBytes,
        status: row?.status,
        contentKind: sniff.kind,
      },
    });
  });

  /** Download raw bytes — ownership checked against the DB row, never the key. */
  routes.get("/files/:attachmentId", async (c) => {
    const s = requireWorkspace(c);
    const storage = requireStorage(deps);
    const attachmentId = c.req.param("attachmentId");
    const [row] = await deps.db
      .select()
      .from(attachments)
      .where(and(eq(attachments.id, attachmentId), eq(attachments.userId, s.userId)))
      .limit(1);
    if (!row) throw new AppError("NOT_FOUND", "Lampiran tidak ditemukan.", 404);
    const obj = await storage.get(row.objectKey);
    return new Response(new Uint8Array(obj.body), {
      headers: {
        "Content-Type": row.contentType,
        "Content-Length": String(obj.body.length),
        "Content-Disposition": `attachment; filename="${row.originalName.replace(/["\\]/g, "")}"`,
        "Cache-Control": "private, no-store",
      },
    });
  });

  /** Delete a draft attachment (before send) — object removed, row removed. */
  routes.delete("/files/:attachmentId", async (c) => {
    const s = requireWorkspace(c);
    const storage = requireStorage(deps);
    const attachmentId = c.req.param("attachmentId");
    const [row] = await deps.db
      .select()
      .from(attachments)
      .where(and(eq(attachments.id, attachmentId), eq(attachments.userId, s.userId)))
      .limit(1);
    if (!row) throw new AppError("NOT_FOUND", "Lampiran tidak ditemukan.", 404);
    await storage.remove(row.objectKey);
    await deps.db.delete(attachments).where(eq(attachments.id, row.id));
    return c.json({ deleted: true });
  });
}
