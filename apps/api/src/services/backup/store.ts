import { and, desc, eq } from "drizzle-orm";
import { configBackups, backupSettings } from "../../db/schema";
import { computeDiff, type DiffResult } from "./diff";
import { redactExport } from "./redact";
import type { BackupCtx, ConfigBackupDTO } from "./types";

export function toDTO(row: typeof configBackups.$inferSelect): ConfigBackupDTO {
  return {
    id: row.id,
    connectionId: row.connectionId,
    name: row.name,
    type: row.type as "export_text" | "binary_backup",
    routerIdentity: row.routerIdentity,
    rosVersion: row.rosVersion,
    boardName: row.boardName,
    sizeBytes: row.sizeBytes,
    status: row.status,
    createdBy: row.createdBy,
    errorMessage: row.errorMessage,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listBackups(ctx: BackupCtx, userId: string, opts: { connectionId?: string; limit?: number; offset?: number } = {}) {
  const limit = Math.min(opts.limit ?? 50, 200);
  const conditions = [eq(configBackups.userId, userId)];
  if (opts.connectionId) conditions.push(eq(configBackups.connectionId, opts.connectionId));

  const rows = await ctx.db
    .select()
    .from(configBackups)
    .where(and(...conditions))
    .orderBy(desc(configBackups.createdAt))
    .limit(limit)
    .offset(opts.offset ?? 0);
  return rows.map(toDTO);
}

export async function getBackup(ctx: BackupCtx, userId: string, backupId: string) {
  const [row] = await ctx.db
    .select()
    .from(configBackups)
    .where(and(eq(configBackups.id, backupId), eq(configBackups.userId, userId)))
    .limit(1);
  if (!row) return null;
  return {
    ...toDTO(row),
    content: row.content,
    contentHash: row.contentHash,
  };
}

export async function compareBackups(ctx: BackupCtx, userId: string, backupId1: string, backupId2: string): Promise<DiffResult | null> {
  const [b1] = await ctx.db.select().from(configBackups).where(and(eq(configBackups.id, backupId1), eq(configBackups.userId, userId))).limit(1);
  const [b2] = await ctx.db.select().from(configBackups).where(and(eq(configBackups.id, backupId2), eq(configBackups.userId, userId))).limit(1);
  if (!b1?.content || !b2?.content) return null;
  return computeDiff(b1.content, b2.content);
}

export async function compareWithLive(ctx: BackupCtx, userId: string, backupId: string, connectionId: string): Promise<DiffResult | null> {
  const [backup] = await ctx.db.select().from(configBackups).where(and(eq(configBackups.id, backupId), eq(configBackups.userId, userId))).limit(1);
  if (!backup?.content) return null;

  const conn = await ctx.connectors.requireOwned(userId, connectionId)();
  if (conn.status !== "connected") return null;

  const password = await ctx.connectors.decryptCredential(userId, connectionId);
  const result = await ctx.execFn({
    host: conn.host, port: conn.port, username: conn.username, password,
    command: "/export", timeoutMs: 60_000, maxOutputChars: 2_000_000,
  });
  const liveContent = redactExport(result.output);
  return computeDiff(backup.content, liveContent);
}

export async function removeBackup(ctx: BackupCtx, userId: string, backupId: string) {
  await ctx.db.delete(configBackups).where(and(eq(configBackups.id, backupId), eq(configBackups.userId, userId)));
}

export async function enforceRetention(ctx: BackupCtx, userId: string, connectionId: string) {
  const [settings] = await ctx.db.select().from(backupSettings).where(eq(backupSettings.userId, userId)).limit(1);
  const maxBackups = settings?.maxBackupsPerRouter ?? 20;

  const rows = await ctx.db
    .select({ id: configBackups.id })
    .from(configBackups)
    .where(and(eq(configBackups.connectionId, connectionId), eq(configBackups.userId, userId)))
    .orderBy(desc(configBackups.createdAt));

  if (rows.length > maxBackups) {
    const toDelete = rows.slice(maxBackups).map((r) => r.id);
    for (const id of toDelete) {
      await ctx.db.delete(configBackups).where(eq(configBackups.id, id));
    }
  }
}
