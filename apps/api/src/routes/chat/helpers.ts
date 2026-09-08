import { and, eq } from "drizzle-orm";
import { AppError } from "../../lib/errors";
import type { WorkspaceContext } from "../../lib/workspace";
import { conversations } from "../../db/schema";
import type { ChatCtx } from "./types";

export function requireWorkspace(c: { get: (k: "workspace") => unknown }): WorkspaceContext {
  const s = c.get("workspace");
  if (!s) throw new AppError("UNAUTHORIZED", "Session habis atau belum login. Silakan login kembali.", 401);
  return s as WorkspaceContext;
}

export async function requireConversation(ctx: ChatCtx, userId: string, conversationId: string) {
  const [conv] = await ctx.deps.db
    .select()
    .from(conversations)
    .where(and(eq(conversations.id, conversationId), eq(conversations.userId, userId)))
    .limit(1);
  if (!conv) throw new AppError("NOT_FOUND", "Percakapan tidak ditemukan.", 404);
  return conv;
}

export function toConversationDTO(r: typeof conversations.$inferSelect) {
  return {
    id: r.id,
    title: r.title,
    activeConnectionId: r.activeConnectionId,
    createdAt: (r.createdAt as Date).toISOString(),
    updatedAt: (r.updatedAt as Date).toISOString(),
    pinnedAt: r.pinnedAt ? (r.pinnedAt as Date).toISOString() : null,
    archivedAt: r.archivedAt ? (r.archivedAt as Date).toISOString() : null,
    revision: (r as { revision?: number }).revision ?? 1,
  };
}
