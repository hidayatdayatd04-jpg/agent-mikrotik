import { Client } from "ssh2";
import { AppError } from "../lib/errors";
import { createHash } from "node:crypto";

export interface SshExecOptions {
  host: string;
  port: number;
  username: string;
  password: string;
  command: string;
  timeoutMs: number;
  /** Optional for bounded inventory reads; existing command callers keep 64K. */
  maxOutputChars?: number;
  expectFingerprint?: string | null;
}

export interface SshExecResult {
  output: string;
  exitCode: number | null;
  durationMs: number;
  truncated?: boolean;
}

export function sshExec(opts: SshExecOptions, createClient = () => new Client()): Promise<SshExecResult> {
  return new Promise((resolve, reject) => {
    const conn = createClient();
    const started = Date.now();
    let output = "";
    let truncated = false;
    const maxOutput = opts.maxOutputChars ?? 64_000;
    const append = (d: Buffer) => {
      const chunk = d.toString("utf8");
      if (output.length + chunk.length > maxOutput) truncated = true;
      output = (output + chunk).slice(0, maxOutput);
    };
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        try {
          conn.end();
        } catch {
          /* ignore */
        }
        reject(new AppError("SSH_TIMEOUT", "SSH timeout saat eksekusi perintah.", 504));
      }
    }, opts.timeoutMs);
    conn
      .on("ready", () => {
        if (settled) return;
        conn.exec(opts.command, (err, stream) => {
          if (settled) { stream?.close(); return; }
          if (err) {
            clearTimeout(timer);
            settled = true;
            conn.end();
            reject(new AppError("SSH_UNREACHABLE", err.message, 502));
            return;
          }
          stream
            .on("data", append)
            .on("error", (error: Error) => {
              if (settled) return;
              settled = true;
              clearTimeout(timer);
              conn.end();
              reject(new AppError("SSH_UNREACHABLE", error.message.slice(0, 300), 502));
            })
            .on("close", (code: number | null) => {
              if (settled) return;
              settled = true;
              clearTimeout(timer);
              conn.end();
              resolve({ output, exitCode: typeof code === "number" ? code : null, durationMs: Date.now() - started, truncated });
            });
          stream.stderr.on("data", append);
        });
      })
      .on("error", (err: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        conn.end();
        const msg = err.message ?? String(err);
        if (/auth|password|denied/i.test(msg)) reject(new AppError("SSH_AUTH_FAILED", "Autentikasi SSH gagal.", 400));
        else reject(new AppError("SSH_UNREACHABLE", msg.slice(0, 300), 502));
      })
      .on("close", () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(new AppError("SSH_UNREACHABLE", "Koneksi SSH terputus sebelum perintah selesai.", 502));
      })
      .connect({ host: opts.host, port: opts.port, username: opts.username, password: opts.password, readyTimeout: opts.timeoutMs,
        ...(opts.expectFingerprint ? { hostVerifier: (key: Buffer) => {
          const fingerprint = `SHA256:${createHash("sha256").update(key).digest("base64").replace(/=+$/, "")}`;
          if (fingerprint === opts.expectFingerprint?.replace(/=+$/, "")) return true;
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            reject(new AppError("HOST_KEY_CHANGED", "Fingerprint SSH berubah. Periksa connector sebelum membaca topologi.", 400));
          }
          return false;
        } } : {}),
      });
  });
}
