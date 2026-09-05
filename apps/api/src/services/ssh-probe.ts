import { createHash } from "node:crypto";
import type { ConnectConfig, ClientChannel } from "ssh2";
import { Client as SshClient } from "ssh2";

export interface SshProbeResult {
  ok: boolean;
  kind: "auth-failed" | "unreachable" | "timeout" | "refused" | "hostkey-changed" | "ok" | "unknown";
  fingerprint: string | null;
  routerIdentity: string | null;
  message: string;
}

export interface SshProbeOptions {
  host: string;
  port: number;
  username: string;
  password: string;
  /** Pinned fingerprint (SHA256:base64). When null, any host key is accepted (TOFU first connect). */
  expectFingerprint: string | null;
  timeoutMs: number;
}

function fingerprintOf(key: Buffer): string {
  return `SHA256:${createHash("sha256").update(key).digest("base64")}`;
}

/**
 * Performs an SSH pre-auth + exec probe against a MikroTik router.
 * - always computes the host key fingerprint (pin on first success, verify after)
 * - verifies host key when a pinned fingerprint exists (rejects silent changes)
 * - runs /system identity print to prove management access
 */
export function probeRouter(opts: SshProbeOptions): Promise<SshProbeResult> {
  return new Promise((resolve) => {
    const conn = new SshClient();
    let settled = false;
    let seenFingerprint: string | null = null;
    const finish = (r: SshProbeResult) => {
      if (settled) return;
      settled = true;
      try {
        conn.end();
      } catch {
        /* ignore */
      }
      resolve(r);
    };
    const timer = setTimeout(() => {
      finish({ ok: false, kind: "timeout", fingerprint: null, routerIdentity: null, message: `SSH timeout setelah ${opts.timeoutMs}ms` });
    }, opts.timeoutMs);

    conn.on("ready", () => {
      conn.exec("/system identity print", (err, stream) => {
        if (err || !stream) {
          clearTimeout(timer);
          return finish({ ok: false, kind: "unknown", fingerprint: seenFingerprint, routerIdentity: null, message: "Gagal membuka channel SSH." });
        }
        let out = "";
        (stream as ClientChannel).on("data", (d: Buffer) => {
          out += d.toString("utf8");
        });
        (stream as ClientChannel).on("close", () => {
          clearTimeout(timer);
          const identityMatch = out.match(/identity:\s*(\S+)/i);
          finish({
            ok: true,
            kind: "ok",
            fingerprint: seenFingerprint,
            routerIdentity: identityMatch?.[1] ?? "unknown",
            message: "Koneksi SSH berhasil.",
          });
        });
        (stream as ClientChannel).on("error", (e: Error) => {
          clearTimeout(timer);
          finish({ ok: false, kind: "unknown", fingerprint: seenFingerprint, routerIdentity: null, message: `Gagal menjalankan perintah: ${e.message}` });
        });
      });
    });

    conn.on("error", (err: Error & { code?: string }) => {
      clearTimeout(timer);
      const msg = err.message ?? "unknown error";
      if (err.code === "ECONNREFUSED") {
        return finish({ ok: false, kind: "refused", fingerprint: null, routerIdentity: null, message: "Port SSH ditolak (service SSH tidak aktif?)." });
      }
      if (err.code === "ETIMEDOUT" || err.code === "ENOTFOUND" || err.code === "EHOSTUNREACH" || err.code === "ECONNRESET") {
        return finish({ ok: false, kind: "unreachable", fingerprint: null, routerIdentity: null, message: `Host tidak terjangkau: ${msg}` });
      }
      if (/All configured authentication methods failed|authentication/i.test(msg)) {
        return finish({ ok: false, kind: "auth-failed", fingerprint: null, routerIdentity: null, message: "Autentikasi SSH gagal (username/password salah)." });
      }
      finish({ ok: false, kind: "unknown", fingerprint: null, routerIdentity: null, message: msg });
    });

    conn.on("close", () => {
      // Socket closed before ready and without an error event: classify as unreachable.
      if (!settled) {
        clearTimeout(timer);
        finish({ ok: false, kind: "unreachable", fingerprint: null, routerIdentity: null, message: "Koneksi ditutup sebelum handshake selesai." });
      }
    });

    const config: ConnectConfig = {
      host: opts.host,
      port: opts.port,
      username: opts.username,
      password: opts.password,
      readyTimeout: opts.timeoutMs,
      hostVerifier: (key: Buffer) => {
        seenFingerprint = fingerprintOf(key);
        if (opts.expectFingerprint && seenFingerprint !== opts.expectFingerprint) {
          finish({
            ok: false,
            kind: "hostkey-changed",
            fingerprint: seenFingerprint,
            routerIdentity: null,
            message: `Fingerprint host key berubah (${seenFingerprint} != ${opts.expectFingerprint}).`,
          });
          return false;
        }
        return true;
      },
    };

    conn.connect(config);
  });
}
