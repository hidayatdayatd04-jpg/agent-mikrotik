import { and, eq } from "drizzle-orm";
import type { Database } from "../../db";
import { AppError } from "../../lib/errors";
import { conversations } from "../../db/schema";
import type { StorageService } from "../../services/storage";

export interface AttachmentRouteDeps {
  db: Database;
  storage: StorageService | null;
}

export function requireStorage(deps: AttachmentRouteDeps): StorageService {
  if (!deps.storage) {
    throw new AppError("STORAGE_UNAVAILABLE", "Penyimpanan lokal tidak tersedia.", 503);
  }
  return deps.storage;
}

export async function requireConversationOwned(deps: AttachmentRouteDeps, userId: string, conversationId: string) {
  const [conv] = await deps.db
    .select({ id: conversations.id })
    .from(conversations)
    .where(and(eq(conversations.id, conversationId), eq(conversations.userId, userId)))
    .limit(1);
  if (!conv) throw new AppError("NOT_FOUND", "Percakapan tidak ditemukan.", 404);
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
export function extForName(name: string, mimeType: string): string {
  const lower = name.toLowerCase();
  const ext = lower.includes(".") ? lower.slice(lower.lastIndexOf(".") + 1) : "";
  if (["png", "jpg", "jpeg", "webp", "pdf", "txt", "csv", "log", "rsc"].includes(ext)) return ext;
  return UPLOAD_EXT[mimeType] ?? "bin";
}
