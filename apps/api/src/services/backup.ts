import type { Database } from "../db";
import type { ConnectorService } from "./connector";
import { sshExec } from "./ssh-exec";
import { compareBackups, compareWithLive, getBackup, listBackups, removeBackup } from "./backup/store";
import { createSnapshot } from "./backup/snapshot";
import type { BackupCtx } from "./backup/types";

export { redactExport } from "./backup/redact";
export { computeDiff } from "./backup/diff";
export type { DiffLine, DiffResult } from "./backup/diff";
export type { ConfigBackupDTO } from "./backup/types";

export function createBackupService(deps: {
  db: Database;
  connectors: Pick<ConnectorService, "requireOwned" | "decryptCredential">;
  exec?: typeof sshExec;
}) {
  const ctx: BackupCtx = { db: deps.db, connectors: deps.connectors, execFn: deps.exec ?? sshExec };

  return {
    createSnapshot: (userId: string, connectionId: string, opts?: { name?: string; createdBy?: string }) => createSnapshot(ctx, userId, connectionId, opts),
    listBackups: (userId: string, opts?: { connectionId?: string; limit?: number; offset?: number }) => listBackups(ctx, userId, opts),
    getBackup: (userId: string, backupId: string) => getBackup(ctx, userId, backupId),
    compareBackups: (userId: string, backupId1: string, backupId2: string) => compareBackups(ctx, userId, backupId1, backupId2),
    compareWithLive: (userId: string, backupId: string, connectionId: string) => compareWithLive(ctx, userId, backupId, connectionId),
    removeBackup: (userId: string, backupId: string) => removeBackup(ctx, userId, backupId),
  };
}

export type BackupService = ReturnType<typeof createBackupService>;
