import type { SafeModeSession, TransactionContext } from "./coordinator";
import { AppError } from "../lib/errors";
import { sessionKey, type SafeSessionState } from "./safe-session-types";

/** Open (or reuse) the write-mode child for this connection. */
export async function openSession(state: SafeSessionState, ctx: TransactionContext): Promise<SafeModeSession> {
  const { deps, children } = state;
  const conn = await deps.getConnection(ctx.userId, ctx.connectionId);
  const k = sessionKey(ctx.userId, ctx.connectionId);
  const child = await deps.supervisor.getOrSpawn({
    connectionId: ctx.connectionId,
    userId: ctx.userId,
    host: conn.spec.host,
    port: conn.spec.port,
    username: conn.spec.username,
    password: conn.spec.password,
    hostKeyFingerprint: conn.spec.hostKeyFingerprint,
    readOnly: false, // safe mode requires the full toolset on the child
  });
  children.set(k, child);

  const call = async (tool: string, args: Record<string, unknown> = {}): Promise<string> => {
    const res = (await child.client.callTool({ name: tool, arguments: args })) as {
      content?: { type: string; text?: string }[];
      isError?: boolean;
    };
    const text = res.content?.map((c) => (c.type === "text" ? c.text ?? "" : "")).join("\n") ?? "";
    if (res.isError || /^error:/im.test(text)) {
      deps.logger.warn("safemode tool result", { tool, isError: res.isError ?? false, text: text.slice(0, 300) });
    }
    if (res.isError) throw new Error(text || `${tool} gagal`);
    return text;
  };

  const session: SafeModeSession = {
    async enable() {
      const out = await call("enable_safe_mode");
      // RouterOS with an empty admin password halts every interactive
      // shell at "Change your password (Ctrl-C to skip)" → "new password>":
      // no prompt ever appears, so Safe Mode cannot open. Surface this
      // explicitly instead of a generic timeout — the fix is on the router
      // (set an admin password + update the connector credential), not a retry.
      if (/change your password|new password\s*>/i.test(out)) {
        throw new AppError(
          "SAFE_MODE_UNAVAILABLE",
          "Router meminta penggantian password admin (password kosong) sehingga sesi Safe Mode tidak dapat dibuka. Atur password admin di router, perbarui kredensial connector, lalu coba lagi.",
          409,
        );
      }
      if (/^error:/im.test(out)) {
        throw new AppError("SAFE_MODE_UNAVAILABLE", `Safe Mode tidak dapat dibuka: ${out.split("\n")[0]?.replace(/^error:\s*/i, "").slice(0, 200)}`, 409);
      }
    },
    async commit() {
      await call("commit_safe_mode");
    },
    async rollback() {
      await call("rollback_safe_mode");
    },
    async exec(command: string) {
      const out = await call("run_routeros_command", { command });
      return { output: out };
    },
    async status() {
      try {
        const childNow = children.get(k);
        if (!childNow) return "unknown" as const;
        const raw = (await childNow.client.callTool({ name: "safe_mode_status", arguments: {} })) as {
          content?: { type: string; text?: string }[];
        };
        const text = (raw.content ?? []).map((c) => (c.type === "text" ? c.text ?? "" : "")).join("\n").toLowerCase();
        // Upstream strings: "Safe mode is ACTIVE. Changes are pending — they are
        // NOT yet persisted…" vs "Safe mode is NOT active. …". NOTE the active
        // text contains "not" ("are NOT yet persisted"), so the negative
        // phrases must be matched BEFORE any generic "not"/"active" check.
        if (text.includes("not active") || text.includes("inactive") || text.includes("disabled")) {
          return "closed" as const;
        }
        if (text.includes("active") || text.includes("enabled")) {
          return "active" as const;
        }
        if (text.includes("off")) {
          return "closed" as const;
        }
        if (text.includes("on")) {
          return "active" as const;
        }
        deps.logger.warn("safe_mode_status unreadable", { userId: ctx.userId, connectionId: ctx.connectionId, text: text.slice(0, 120) });
        return "unknown" as const;
      } catch (err) {
        deps.logger.warn("safe_mode_status call failed", {
          userId: ctx.userId,
          connectionId: ctx.connectionId,
          error: err instanceof Error ? err.message : String(err),
        });
        return "unknown" as const;
      }
    },
  };
  return session;
}
