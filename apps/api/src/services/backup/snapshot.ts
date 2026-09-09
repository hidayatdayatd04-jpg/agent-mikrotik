import { eq } from "drizzle-orm";
import { createHash } from "node:crypto";
import { configBackups } from "../../db/schema";
import { redactExport } from "./redact";
import { enforceRetention, toDTO } from "./store";
import type { BackupCtx, ConfigBackupDTO } from "./types";

/** Ekspor konfigurasi /export via SSH + redaksi + retensi. */
export async function createSnapshot(ctx: BackupCtx, userId: string, connectionId: string, opts: { name?: string; createdBy?: string } = {}): Promise<ConfigBackupDTO> {
  const { db } = ctx;
  const conn = await ctx.connectors.requireOwned(userId, connectionId)();
  if (conn.status !== "connected") {
    const [row] = await db.insert(configBackups).values({
      connectionId,
      userId,
      name: opts.name ?? `Backup-${new Date().toISOString().replace(/[:.]/g, "-")}`,
      type: "export_text",
      routerIdentity: conn.routerIdentity,
      rosVersion: conn.rosVersion,
      boardName: conn.boardName,
      status: "failed",
      createdBy: opts.createdBy ?? "user",
      errorMessage: "Router tidak terkoneksi.",
    }).returning();
    return toDTO(row!);
  }

  const password = await ctx.connectors.decryptCredential(userId, connectionId);
  const backupName = opts.name ?? `Backup-${new Date().toISOString().replace(/[:.]/g, "-")}`;

  // Create the record first
  const [row] = await db.insert(configBackups).values({
    connectionId,
    userId,
    name: backupName,
    type: "export_text",
    routerIdentity: conn.routerIdentity,
    rosVersion: conn.rosVersion,
    boardName: conn.boardName,
    status: "in_progress",
    createdBy: opts.createdBy ?? "user",
  }).returning();

  try {
    const result = await ctx.execFn({
      host: conn.host,
      port: conn.port,
      username: conn.username,
      password,
      command: "/export",
      timeoutMs: 60_000,
      maxOutputChars: 2_000_000,
    });

    const content = redactExport(result.output);
    const hash = createHash("sha256").update(content).digest("hex");

    await db.update(configBackups).set({
      content,
      contentHash: hash,
      sizeBytes: Buffer.byteLength(content, "utf8"),
      status: "completed",
    }).where(eq(configBackups.id, row!.id));

    // Enforce retention
    await enforceRetention(ctx, userId, connectionId);

    const [updated] = await db.select().from(configBackups).where(eq(configBackups.id, row!.id)).limit(1);
    return toDTO(updated!);
  } catch (err) {
    await db.update(configBackups).set({
      status: "failed",
      errorMessage: err instanceof Error ? err.message.slice(0, 500) : "Backup gagal.",
    }).where(eq(configBackups.id, row!.id));

    const [updated] = await db.select().from(configBackups).where(eq(configBackups.id, row!.id)).limit(1);
    return toDTO(updated!);
  }
}
