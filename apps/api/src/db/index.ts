import { Database as Sqlite } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import * as schema from "./schema";
import { migrations } from "./migrations";
import { LOCAL_WORKSPACE_ID } from "../lib/workspace";

export function createDb(filename: string = ":memory:") {
  if (filename !== ":memory:") mkdirSync(dirname(filename), { recursive: true, mode: 0o700 });
  const sqlite = new Sqlite(filename, { create: true });
  sqlite.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL;");
  sqlite.transaction(() => {
    const version = (sqlite.query("PRAGMA user_version").get() as { user_version: number }).user_version;
    if (version > migrations.length) throw new Error("Data dibuat versi aplikasi lebih baru. Perbarui mikrotik-agent.");
    for (let i = version; i < migrations.length; i++) {
      sqlite.exec(migrations[i]!);
      sqlite.exec(`PRAGMA user_version = ${i + 1}`);
    }
    sqlite.query("INSERT OR IGNORE INTO workspaces (id, name) VALUES (?, ?)").run(LOCAL_WORKSPACE_ID, "Lokal");
  })();
  return drizzle(sqlite, { schema });
}
export type Database = ReturnType<typeof createDb>;

/** Restart never implies success of an interrupted router change. */
export function recoverLocalState(db: Database) {
  db.$client.transaction(() => {
    db.$client.exec("UPDATE change_transactions SET state = 'unknown' WHERE state IN ('preparing','active','verifying','committing','rolling_back');");
    db.$client.exec("UPDATE agent_runs SET status = 'failed' WHERE status IN ('queued','running');");
    db.$client.exec("UPDATE router_connections SET status = 'disconnected';");
    db.$client.exec("UPDATE connection_permissions SET write_enabled = 0, version = version + 1;");
    // Terminal sessions left open across restart are closed as unknown; commands marked failed.
    try {
      db.$client.exec("UPDATE terminal_sessions SET status = 'closed', closed_at = strftime('%s','now')*1000 WHERE status = 'open';");
    } catch {
      /* table may not exist on very old DBs mid-migration */
    }
    try {
      db.$client.exec("UPDATE terminal_commands SET status = 'failed', ended_at = strftime('%s','now')*1000 WHERE status IN ('queued','running');");
    } catch {
      /* ignore */
    }
    try {
      db.$client.exec("UPDATE compaction_jobs SET status = 'failed', error = 'restart' WHERE status IN ('queued','running');");
    } catch {
      /* ignore */
    }
    // Sessions persist across restart by design (revoked only on logout/expiry).
    try {
      db.$client.exec("DELETE FROM sessions WHERE expires_at < strftime('%s','now')*1000;");
    } catch {
      /* ignore */
    }
  })();
}
