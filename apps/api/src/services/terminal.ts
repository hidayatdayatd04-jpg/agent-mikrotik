import { and, eq } from "drizzle-orm";
import type { Database } from "../db";
import { routerConnections, terminalCommands, terminalSessions } from "../db/schema";
import { AppError } from "../lib/errors";
import { redactText } from "../lib/redaction";
import type { Logger } from "../lib/logger";
import { applySafetyDefaults, classifyBatch, isLocalCommand } from "./terminal-classifier";
import { recordActivity } from "./activity";
import { sshExec } from "./ssh-exec";
import { isMcpConnectionError } from "../mcp/recovery";

/** Serialize execution against the same physical router (user terminal vs AI runs). */
const routerLocks = new Map<string, string>(); // routerKey -> owner (sessionId or runId)

export function routerKeyFor(host: string, port: number, username: string): string {
  return `${host}:${port}:${username}`.toLowerCase();
}

export function tryAcquireRouter(key: string, owner: string): boolean {
  if (routerLocks.has(key)) return false;
  routerLocks.set(key, owner);
  return true;
}

export function releaseRouter(key: string, owner: string): void {
  if (routerLocks.get(key) === owner) routerLocks.delete(key);
}

export function routerLockOwner(key: string): string | null {
  return routerLocks.get(key) ?? null;
}

export interface TerminalDeps {
  execSsh?: (opts: Parameters<typeof sshExec>[0]) => ReturnType<typeof sshExec>;
  db: Database;
  logger: Logger;
  decryptCredential: (userId: string, connectionId: string) => Promise<string>;
  getMode: (userId: string, connectionId: string) => Promise<{ mode: "read-only" | "write"; version: number }>;
  transactions?: {
    begin: (input: { userId: string; connectionId: string; routerIdentity: string; runId: string | null; snapshotPlan: { name: string; command: string }[] }) => Promise<{ transactionId: string }>;
    commit: (txId: string, userId: string) => Promise<{ state: string }>;
    rollback: (txId: string, userId: string, meta: { reason: string }) => Promise<{ state: string }>;
    getActionCount: (txId: string) => number;
    recordAction?: (txId: string) => void;
    execInSession?: (txId: string, userId: string, command: string) => Promise<{ output: string }>;
  };
}

export async function openTerminalSession(
  deps: TerminalDeps,
  input: { userId: string; connectionId: string; conversationId?: string | null; actor?: "user" | "ai" },
) {
  const [conn] = await deps.db
    .select()
    .from(routerConnections)
    .where(and(eq(routerConnections.id, input.connectionId), eq(routerConnections.userId, input.userId)))
    .limit(1);
  if (!conn) throw new AppError("NOT_FOUND", "Connector tidak ditemukan.", 404);
  if (conn.status !== "connected") throw new AppError("CONFLICT", "Connector belum terhubung (SSH). Discovery/Winbox bukan bukti SSH aktif.", 409);
  const [row] = await deps.db
    .insert(terminalSessions)
    .values({
      userId: input.userId,
      connectionId: input.connectionId,
      conversationId: input.conversationId ?? null,
      actor: input.actor ?? "user",
      status: "open",
    })
    .returning();
  return row!;
}

export async function submitTerminalCommand(
  deps: TerminalDeps,
  input: { userId: string; sessionId: string; command: string; conversationId?: string | null },
) {
  const raw = input.command.slice(0, 4000);
  if (!raw.trim()) throw new AppError("VALIDATION_FAILED", "Perintah kosong.", 422);
  if (isLocalCommand(raw)) {
    throw new AppError("VALIDATION_FAILED", "Perintah lokal terminal (clear/help) — jalankan di frontend saja.", 422);
  }
  const [sess] = await deps.db.select().from(terminalSessions).where(eq(terminalSessions.id, input.sessionId)).limit(1);
  if (!sess || sess.userId !== input.userId) throw new AppError("NOT_FOUND", "Sesi terminal tidak ditemukan.", 404);
  if (sess.status !== "open") throw new AppError("CONFLICT", "Sesi terminal sudah ditutup.", 409);

  const [conn] = await deps.db
    .select()
    .from(routerConnections)
    .where(and(eq(routerConnections.id, sess.connectionId), eq(routerConnections.userId, input.userId)))
    .limit(1);
  if (!conn) throw new AppError("NOT_FOUND", "Connector tidak ditemukan.", 404);
  if (conn.status !== "connected") throw new AppError("CONFLICT", "Router terputus; reconnect dahulu. Output sebelumnya tidak diulang.", 409);

  const { commands, overall, blocked } = classifyBatch(raw);
  const [cmdRow] = await deps.db
    .insert(terminalCommands)
    .values({ sessionId: sess.id, command: raw, status: blocked ? "rejected" : "queued" })
    .returning();
  if (blocked) {
    await deps.db.update(terminalCommands).set({ status: "rejected", errorCode: "VALIDATION_FAILED", endedAt: new Date(), outputPreview: blocked.slice(0, 2000) }).where(eq(terminalCommands.id, cmdRow!.id));
    if (input.conversationId ?? sess.conversationId) {
      await recordActivity(deps.db, {
        conversationId: (input.conversationId ?? sess.conversationId)!,
        type: "terminal.rejected",
        actor: "user",
        activityId: `term-${cmdRow!.id}`,
        payload: { command: raw.slice(0, 500), reason: blocked },
      });
    }
    throw new AppError("VALIDATION_FAILED", blocked, 422);
  }

  const { mode } = await deps.getMode(input.userId, sess.connectionId);
  if (overall === "write" && mode !== "write") {
    await deps.db.update(terminalCommands).set({ status: "rejected", errorCode: "WRITE_DISABLED", endedAt: new Date(), outputPreview: "Mode Read-Only: mutasi ditolak." }).where(eq(terminalCommands.id, cmdRow!.id));
    throw new AppError("WRITE_DISABLED", "Mode Read-Only aktif. Ubah izin via composer untuk mutasi.", 403);
  }

  const key = routerKeyFor(conn.host, conn.port, conn.username);
  const owner = `term:${cmdRow!.id}`;
  if (!tryAcquireRouter(key, owner)) {
    await deps.db.update(terminalCommands).set({ status: "rejected", errorCode: "CONFLICT", endedAt: new Date(), outputPreview: "Router sedang digunakan" }).where(eq(terminalCommands.id, cmdRow!.id));
    throw new AppError("CONFLICT", "Router sedang digunakan run/sesi lain. Tunggu hingga selesai.", 409);
  }

  // Background execution (POST returns commandId immediately; output via polling/events).
  void (async () => {
    const started = Date.now();
    let txId: string | null = null;
    let combined = "";
    try {
      await deps.db.update(terminalCommands).set({ status: "running" }).where(eq(terminalCommands.id, cmdRow!.id));
      const password = await deps.decryptCredential(input.userId, sess.connectionId);
      if (overall === "write") {
        if (!deps.transactions) throw new AppError("SAFE_MODE_UNAVAILABLE", "Layanan transaksi tidak tersedia.", 409);
        if (!conn.routerIdentity) throw new AppError("CONFLICT", "Identitas router belum terverifikasi.", 409);
        const res = await deps.transactions.begin({
          userId: input.userId,
          connectionId: sess.connectionId,
          routerIdentity: conn.routerIdentity,
          runId: null,
          snapshotPlan: [{ name: "identity", command: "/system identity print" }],
        });
        txId = res.transactionId;
        await deps.db.update(terminalCommands).set({ transactionId: txId }).where(eq(terminalCommands.id, cmdRow!.id));
      }
      let truncated = false;
      for (const c of commands) {
        const { command: execCmd, injected } = applySafetyDefaults(c.raw);
        let output = "";
        if (txId) {
          if (!deps.transactions?.execInSession) throw new AppError("SAFE_MODE_UNAVAILABLE", "Sesi transaksi tidak tersedia untuk eksekusi perintah.", 409);
          const execRes = await deps.transactions.execInSession(txId, input.userId, execCmd);
          output = execRes.output;
        } else {
          const res = await (deps.execSsh ?? sshExec)({ host: conn.host, port: conn.port, username: conn.username, password, command: execCmd, timeoutMs: 30_000 });
          output = res.output;
          if (res.exitCode !== null && res.exitCode !== 0) throw new AppError("UPSTREAM_ERROR", output || `Perintah berakhir dengan kode ${res.exitCode}.`, 502);
        }
        if (/^(?:failure:|error:|syntax error|bad command name|expected end of command|no such item)/im.test(output)) throw new AppError("UPSTREAM_ERROR", output, 502);
        const redacted = redactText(output);
        combined += `$ ${c.raw}\n${injected ? `# ${injected}\n` : ""}${redacted}\n`;
        if (combined.length > 32_000) {
          combined = combined.slice(0, 32_000);
          truncated = true;
        }
      }
      const durationMs = Date.now() - started;
      if (txId && deps.transactions) {
        const actions = deps.transactions.getActionCount(txId);
        const result = actions > 0 ? await deps.transactions.commit(txId, input.userId) : await deps.transactions.rollback(txId, input.userId, { reason: "empty" });
        if ((actions > 0 && result.state !== "committed") || (actions === 0 && result.state !== "rolled_back")) {
          throw new AppError("TRANSACTION_UNKNOWN", "Hasil transaksi belum terverifikasi. Perubahan belum dapat dinyatakan berhasil.", 409);
        }
        combined += `\n[transaksi ${result.state}]`;
      }
      await deps.db
        .update(terminalCommands)
        .set({ status: "completed", exitCode: null, durationMs, outputPreview: combined.slice(0, 8000), truncated: truncated || combined.length > 8000, endedAt: new Date() })
        .where(eq(terminalCommands.id, cmdRow!.id));
      const convId = input.conversationId ?? sess.conversationId;
      if (convId) {
        await recordActivity(deps.db, {
          conversationId: convId,
          type: "terminal.completed",
          actor: "user",
          activityId: `term-${cmdRow!.id}`,
          payload: {
            command: raw.slice(0, 500),
            status: "completed",
            durationMs,
            truncated,
            transactionId: txId,
            outputPreview: combined.slice(0, 2000),
          },
        });
      }
    } catch (err) {
      if (txId && deps.transactions) {
        try {
          await deps.transactions.rollback(txId, input.userId, { reason: err instanceof Error ? err.message.slice(0, 200) : "gagal" });
        } catch {
          /* ignore */
        }
      }
      const msg = isMcpConnectionError(err)
        ? "Koneksi router terputus. Status perubahan perlu diverifikasi sebelum mengulangi perintah."
        : err instanceof Error ? err.message : String(err);
      const code = err instanceof AppError ? err.code : isMcpConnectionError(err) ? "SSH_UNREACHABLE" : "INTERNAL_ERROR";
      await deps.db
        .update(terminalCommands)
        .set({ status: "failed", errorCode: code, durationMs: Date.now() - started, outputPreview: redactText(`${combined}\n${msg}`).slice(0, 8000), endedAt: new Date() })
        .where(eq(terminalCommands.id, cmdRow!.id));
    } finally {
      releaseRouter(key, owner);
    }
  })();

  return { commandId: cmdRow!.id, status: "queued" as const };
}
