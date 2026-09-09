import { eq } from "drizzle-orm";
import { terminalCommands } from "../../db/schema";
import { AppError } from "../../lib/errors";
import { redactText } from "../../lib/redaction";
import { recordActivity } from "../activity";
import { sshExec } from "../ssh-exec";
import { isMcpConnectionError } from "../../mcp/recovery";
import { applySafetyDefaults } from "../terminal-classifier";
import { releaseRouter } from "./locks";
import type { TerminalDeps } from "./types";
import type { QueuedTerminalCommand } from "./submit";

/** Eksekusi background: SSH/tx-session per perintah + settlement + aktivitas. */
export async function executeTerminalCommand(
  deps: TerminalDeps,
  input: { userId: string; conversationId?: string | null },
  q: QueuedTerminalCommand,
): Promise<void> {
  const { key, owner, cmdRowId, raw, commands, overall, conn } = q;
  const started = Date.now();
  let txId: string | null = null;
  let combined = "";
  try {
    await deps.db.update(terminalCommands).set({ status: "running" }).where(eq(terminalCommands.id, cmdRowId));
    const password = await deps.decryptCredential(input.userId, q.sess.connectionId);
    if (overall === "write") {
      if (!deps.transactions) throw new AppError("SAFE_MODE_UNAVAILABLE", "Layanan transaksi tidak tersedia.", 409);
      if (!conn.routerIdentity) throw new AppError("CONFLICT", "Identitas router belum terverifikasi.", 409);
      const res = await deps.transactions.begin({
        userId: input.userId,
        connectionId: q.sess.connectionId,
        routerIdentity: conn.routerIdentity,
        runId: null,
        snapshotPlan: [{ name: "identity", command: "/system identity print" }],
      });
      txId = res.transactionId;
      await deps.db.update(terminalCommands).set({ transactionId: txId }).where(eq(terminalCommands.id, cmdRowId));
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
      .where(eq(terminalCommands.id, cmdRowId));
    const convId = input.conversationId ?? q.sess.conversationId;
    if (convId) {
      await recordActivity(deps.db, {
        conversationId: convId,
        type: "terminal.completed",
        actor: "user",
        activityId: `term-${cmdRowId}`,
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
      .where(eq(terminalCommands.id, cmdRowId));
  } finally {
    releaseRouter(key, owner);
  }
}
