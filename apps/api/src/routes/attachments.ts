import { Hono } from "hono";
import { and, eq, isNull, lt, ne, or } from "drizzle-orm";
import type { Env } from "../types";
import type { Database } from "../db";
import { AppError } from "../lib/errors";
import { attachments, conversations } from "../db/schema";
import type { Logger } from "../lib/logger";
import type { WorkspaceContext } from "../lib/workspace";
import type { StorageService, } from "../services/storage";
import { detectContentKind } from "../services/storage";

/** Validated local attachments, served only through the API. */
export function createAttachmentRoutes(deps: {
  db: Database;
  logger: Logger;
  storage: StorageService | null;
  limits: { maxBytes: number; maxFilesPerMessage: number };
}) {
  const routes = new Hono<Env>();

  function requireWorkspace(c: { get: (k: "workspace") => unknown }): WorkspaceContext {
    const s = c.get("workspace");
    if (!s) throw new AppError("UNAUTHORIZED", "Session habis atau belum login. Silakan login kembali.", 401);
    return s as WorkspaceContext;
  }

  function requireStorage(): StorageService {
    if (!deps.storage) {
      throw new AppError("STORAGE_UNAVAILABLE", "Penyimpanan lokal tidak tersedia.", 503);
    }
    return deps.storage;
  }

  async function requireConversationOwned(userId: string, conversationId: string) {
    const [conv] = await deps.db
      .select({ id: conversations.id })
      .from(conversations)
      .where(and(eq(conversations.id, conversationId), eq(conversations.userId, userId)))
      .limit(1);
    if (!conv) throw new AppError("NOT_FOUND", "Percakapan tidak ditemukan.", 404);
  }

  /** Effective limits for the UI. */
  routes.get("/limits", (c) => {
    requireWorkspace(c);
    return c.json({
      maxBytes: deps.limits.maxBytes,
      maxFilesPerMessage: deps.limits.maxFilesPerMessage,
      accepted: ["png", "jpg", "jpeg", "webp", "pdf", "txt", "csv", "log", "rsc"],
    });
  });

  /** Upload one file into a conversation. Multipart, streamed with a hard byte cap. */
  routes.post("/:conversationId/files", async (c) => {
    const s = requireWorkspace(c);
    const storage = requireStorage();
    const conversationId = c.req.param("conversationId");
    await requireConversationOwned(s.userId, conversationId);

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

  /** List attachments of a conversation (owner only). */
  routes.get("/:conversationId/files", async (c) => {
    const s = requireWorkspace(c);
    const conversationId = c.req.param("conversationId");
    await requireConversationOwned(s.userId, conversationId);
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

  /** Download raw bytes — ownership checked against the DB row, never the key. */
  routes.get("/files/:attachmentId", async (c) => {
    const s = requireWorkspace(c);
    const storage = requireStorage();
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
    const storage = requireStorage();
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

  /** Orphan sweep: uploading/failed rows older than cutoff with no message bound. */
  routes.post("/cleanup", async (c) => {
    const s = requireWorkspace(c);
    const storage = requireStorage();
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

  return routes;
}

const UPLOAD_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "application/pdf": "pdf",
  "text/plain": "txt",
  "text/csv": "csv",
  "text/log": "log",
  "application/octet-stream": "bin",
};

/** Server-side ext from the ORIGINAL name, validated against the sniffed kind. */
function extForName(name: string, mimeType: string): string {
  const lower = name.toLowerCase();
  const ext = lower.includes(".") ? lower.slice(lower.lastIndexOf(".") + 1) : "";
  if (["png", "jpg", "jpeg", "webp", "pdf", "txt", "csv", "log", "rsc"].includes(ext)) return ext;
  return UPLOAD_EXT[mimeType] ?? "bin";
}
