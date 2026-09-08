import type { Database } from "../db";
import { configBackups, backupSettings } from "../db/schema";
import { eq, and, desc } from "drizzle-orm";
import { sshExec } from "./ssh-exec";
import type { ConnectorService } from "./connector";
import { createHash } from "node:crypto";

/** Regex patterns to redact sensitive fields from RouterOS exports. */
const REDACT_PATTERNS = [
  /password=("[^"]*"|[^\s]+)/gi,
  /secret=("[^"]*"|[^\s]+)/gi,
  /private-key=("[^"]*"|[^\s]+)/gi,
  /passphrase=("[^"]*"|[^\s]+)/gi,
  /community=("[^"]*"|[^\s]+)/gi,
  /auth-key=("[^"]*"|[^\s]+)/gi,
  /priv-key=("[^"]*"|[^\s]+)/gi,
  /wpa-pre-shared-key=("[^"]*"|[^\s]+)/gi,
  /wpa2-pre-shared-key=("[^"]*"|[^\s]+)/gi,
  /certificate=("[^"]*"|[^\s]+)/gi,
  /shared-secret=("[^"]*"|[^\s]+)/gi,
];

export function redactExport(content: string): string {
  let result = content;
  for (const pattern of REDACT_PATTERNS) {
    result = result.replace(pattern, (match) => {
      const eqIdx = match.indexOf("=");
      return `${match.substring(0, eqIdx + 1)}[REDACTED]`;
    });
  }
  return result;
}

export interface ConfigBackupDTO {
  id: string;
  connectionId: string;
  name: string;
  type: "export_text" | "binary_backup";
  routerIdentity: string | null;
  rosVersion: string | null;
  boardName: string | null;
  sizeBytes: number;
  status: string;
  createdBy: string;
  errorMessage: string | null;
  createdAt: string;
}

export interface DiffResult {
  added: number;
  removed: number;
  changed: number;
  lines: DiffLine[];
}

export interface DiffLine {
  type: "added" | "removed" | "unchanged";
  lineNumber: { left: number | null; right: number | null };
  content: string;
}

export function computeDiff(left: string, right: string): DiffResult {
  const leftLines = left.split("\n");
  const rightLines = right.split("\n");
  const result: DiffLine[] = [];
  let added = 0, removed = 0;

  // Simple LCS-based diff
  const lcs = buildLCS(leftLines, rightLines);
  let li = 0, ri = 0, ci = 0;

  while (li < leftLines.length || ri < rightLines.length) {
    if (ci < lcs.length && li < leftLines.length && ri < rightLines.length && leftLines[li] === lcs[ci] && rightLines[ri] === lcs[ci]) {
      result.push({ type: "unchanged", lineNumber: { left: li + 1, right: ri + 1 }, content: leftLines[li]! });
      li++; ri++; ci++;
    } else if (ci < lcs.length && li < leftLines.length && leftLines[li] !== lcs[ci]) {
      result.push({ type: "removed", lineNumber: { left: li + 1, right: null }, content: leftLines[li]! });
      removed++;
      li++;
    } else if (ci < lcs.length && ri < rightLines.length && rightLines[ri] !== lcs[ci]) {
      result.push({ type: "added", lineNumber: { left: null, right: ri + 1 }, content: rightLines[ri]! });
      added++;
      ri++;
    } else if (li < leftLines.length) {
      result.push({ type: "removed", lineNumber: { left: li + 1, right: null }, content: leftLines[li]! });
      removed++;
      li++;
    } else if (ri < rightLines.length) {
      result.push({ type: "added", lineNumber: { left: null, right: ri + 1 }, content: rightLines[ri]! });
      added++;
      ri++;
    }
  }

  return { added, removed, changed: Math.min(added, removed), lines: result };
}

function buildLCS(a: string[], b: string[]): string[] {
  // Optimized for reasonable-length configs; caps at 5000 lines per side
  const maxLen = 5000;
  const aa = a.slice(0, maxLen);
  const bb = b.slice(0, maxLen);
  const m = aa.length, n = bb.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i]![j] = aa[i - 1] === bb[j - 1] ? dp[i - 1]![j - 1]! + 1 : Math.max(dp[i - 1]![j]!, dp[i]![j - 1]!);
    }
  }
  const result: string[] = [];
  let i = m, j = n;
  while (i > 0 && j > 0) {
    if (aa[i - 1] === bb[j - 1]) { result.unshift(aa[i - 1]!); i--; j--; }
    else if (dp[i - 1]![j]! > dp[i]![j - 1]!) i--;
    else j--;
  }
  return result;
}

export function createBackupService(deps: {
  db: Database;
  connectors: Pick<ConnectorService, "requireOwned" | "decryptCredential">;
  exec?: typeof sshExec;
}) {
  const { db } = deps;
  const execFn = deps.exec ?? sshExec;

  async function createSnapshot(userId: string, connectionId: string, opts: { name?: string; createdBy?: string } = {}): Promise<ConfigBackupDTO> {
    const conn = await deps.connectors.requireOwned(userId, connectionId)();
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

    const password = await deps.connectors.decryptCredential(userId, connectionId);
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
      const result = await execFn({
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
      await enforceRetention(userId, connectionId);

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

  async function listBackups(userId: string, opts: { connectionId?: string; limit?: number; offset?: number } = {}) {
    const limit = Math.min(opts.limit ?? 50, 200);
    const conditions = [eq(configBackups.userId, userId)];
    if (opts.connectionId) conditions.push(eq(configBackups.connectionId, opts.connectionId));

    const rows = await db
      .select()
      .from(configBackups)
      .where(and(...conditions))
      .orderBy(desc(configBackups.createdAt))
      .limit(limit)
      .offset(opts.offset ?? 0);
    return rows.map(toDTO);
  }

  async function getBackup(userId: string, backupId: string) {
    const [row] = await db
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

  async function compareBackups(userId: string, backupId1: string, backupId2: string): Promise<DiffResult | null> {
    const [b1] = await db.select().from(configBackups).where(and(eq(configBackups.id, backupId1), eq(configBackups.userId, userId))).limit(1);
    const [b2] = await db.select().from(configBackups).where(and(eq(configBackups.id, backupId2), eq(configBackups.userId, userId))).limit(1);
    if (!b1?.content || !b2?.content) return null;
    return computeDiff(b1.content, b2.content);
  }

  async function compareWithLive(userId: string, backupId: string, connectionId: string): Promise<DiffResult | null> {
    const [backup] = await db.select().from(configBackups).where(and(eq(configBackups.id, backupId), eq(configBackups.userId, userId))).limit(1);
    if (!backup?.content) return null;

    const conn = await deps.connectors.requireOwned(userId, connectionId)();
    if (conn.status !== "connected") return null;

    const password = await deps.connectors.decryptCredential(userId, connectionId);
    const result = await execFn({
      host: conn.host, port: conn.port, username: conn.username, password,
      command: "/export", timeoutMs: 60_000, maxOutputChars: 2_000_000,
    });
    const liveContent = redactExport(result.output);
    return computeDiff(backup.content, liveContent);
  }

  async function removeBackup(userId: string, backupId: string) {
    await db.delete(configBackups).where(and(eq(configBackups.id, backupId), eq(configBackups.userId, userId)));
  }

  async function enforceRetention(userId: string, connectionId: string) {
    const [settings] = await db.select().from(backupSettings).where(eq(backupSettings.userId, userId)).limit(1);
    const maxBackups = settings?.maxBackupsPerRouter ?? 20;

    const rows = await db
      .select({ id: configBackups.id })
      .from(configBackups)
      .where(and(eq(configBackups.connectionId, connectionId), eq(configBackups.userId, userId)))
      .orderBy(desc(configBackups.createdAt));

    if (rows.length > maxBackups) {
      const toDelete = rows.slice(maxBackups).map((r) => r.id);
      for (const id of toDelete) {
        await db.delete(configBackups).where(eq(configBackups.id, id));
      }
    }
  }

  function toDTO(row: typeof configBackups.$inferSelect): ConfigBackupDTO {
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

  return { createSnapshot, listBackups, getBackup, compareBackups, compareWithLive, removeBackup };
}

export type BackupService = ReturnType<typeof createBackupService>;
