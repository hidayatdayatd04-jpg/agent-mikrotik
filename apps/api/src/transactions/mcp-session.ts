import type { SafeModeSession, TransactionContext } from "./coordinator";
import type { McpSupervisor, McpChild } from "../mcp/supervisor";
import type { Logger } from "../lib/logger";
import { AppError } from "../lib/errors";

/**
 * SafeModeSession backed by the user's supervised mikrotik-mcp child process.
 *
 * The lifecycle tools (enable/commit/rollback_safe_mode) are upstream MCP tools;
 * the policy dispatcher denies them for model calls — only this adapter, driven
 * by the TransactionCoordinator, may invoke them. All calls go through the SAME
 * child process so the persistent safe-mode shell session stays bound to one
 * connection, as required by the integration contract (docs/integration-contracts.md).
 */
export interface SafeModeSessionContext {
  userId: string;
  connectionId: string;
  spec: {
    host: string;
    port: number;
    username: string;
    password: string | null;
    hostKeyFingerprint: string | null;
  };
}

export function createSafeModeSessionFactory(deps: {
  supervisor: McpSupervisor;
  logger: Logger;
  /** fetch connector context incl. decrypted credentials; reuse the connector service */
  getConnection: (userId: string, connectionId: string) => Promise<SafeModeSessionContext>;
  /** liveness probe budget per attempt (ms). Default 25_000. */
  probeTimeoutMs?: number;
}) {
  const children = new Map<string, McpChild>();
  const probeTimeoutMs = deps.probeTimeoutMs ?? 25_000;

  function key(userId: string, connectionId: string) {
    return `${userId}:${connectionId}`;
  }

  function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | null = null;
    return new Promise<T>((resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms}ms`)), ms);
      p.then(
        (v) => { if (timer) clearTimeout(timer); resolve(v); },
        (e) => { if (timer) clearTimeout(timer); reject(e); },
      );
    });
  }

  return {
    /** Open (or reuse) the write-mode child for this connection. */
    async openSession(ctx: TransactionContext): Promise<SafeModeSession> {
      const conn = await deps.getConnection(ctx.userId, ctx.connectionId);
      const k = key(ctx.userId, ctx.connectionId);
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
    },

    /**
     * Open + enable + PROVE the window is live, self-healing once.
     *
     * Why: upstream tracks Safe Mode with an in-memory flag, so `enable`
     * can report success on a stale/dead shell ("already active") while every
     * later command wedges. The probe (a read routed through the safe shell)
     * is the only real proof. On probe failure the child is stopped — the
     * stale flag dies with it — and a fresh child gets exactly one retry.
     * Read-only probe: never mutates, so a failed attempt leaves nothing staged.
     */
    async openVerifiedSession(ctx: TransactionContext): Promise<SafeModeSession> {
      const k = key(ctx.userId, ctx.connectionId);
      const probeLive = async (child: McpChild): Promise<void> => {
        const raw = (await withTimeout(
          child.client.callTool({ name: "get_system_identity", arguments: {} }),
          probeTimeoutMs,
          "probe sesi Safe Mode",
        )) as { content?: { type: string; text?: string }[]; isError?: boolean };
        if (raw.isError) throw new Error("probe sesi Safe Mode mengembalikan error");
        const text = (raw.content ?? []).map((c) => (c.type === "text" ? c.text ?? "" : "")).join("\n");
        if (!text.trim()) throw new Error("probe sesi Safe Mode kosong");
      };
      const recycleChild = async (why: string) => {
        deps.logger.warn("recycling wedged safe-mode child", { userId: ctx.userId, connectionId: ctx.connectionId, why });
        children.delete(k);
        try {
          await deps.supervisor.stop(ctx.userId, ctx.connectionId);
        } catch {
          /* stop is best-effort; a fresh spawn replaces it anyway */
        }
      };
      const attempt = async (): Promise<SafeModeSession> => {
        const session = await this.openSession(ctx);
        const child = children.get(k);
        if (!child) throw new Error("child Safe Mode tidak tersedia setelah openSession");
        await session.enable();
        await probeLive(child);
        return session;
      };
      try {
        return await attempt();
      } catch (firstErr) {
        await recycleChild(firstErr instanceof Error ? firstErr.message : String(firstErr));
        try {
          const session = await this.openSession(ctx);
          const child = children.get(k);
          if (!child) throw new Error("child Safe Mode tidak tersedia setelah recycle");
          await session.enable();
          await probeLive(child);
          return session;
        } catch (secondErr) {
          await recycleChild(secondErr instanceof Error ? secondErr.message : String(secondErr));
          throw new AppError(
            "SAFE_MODE_UNAVAILABLE",
            `Sesi Safe Mode tidak dapat dipakai (${secondErr instanceof Error ? secondErr.message : String(secondErr)}). Child sudah di-restart; coba lagi. Bila berulang, restart sesi MCP atau reboot router.`,
            409,
          );
        }
      }
    },

    /**
     * Pre-commit management-plane probe: execute a read tool on the SAME child
     * that holds the safe-mode window. A successful SSH command alone does not
     * prove the management plane is healthy — this checks the router still
     * answers identity reads through the transaction's own connection.
     */
    async verifyManagement(ctx: TransactionContext): Promise<{ ok: boolean; detail: string }> {
      try {
        const conn = await deps.getConnection(ctx.userId, ctx.connectionId);
        const child = await deps.supervisor.getOrSpawn({
          connectionId: ctx.connectionId,
          userId: ctx.userId,
          host: conn.spec.host,
          port: conn.spec.port,
          username: conn.spec.username,
          password: conn.spec.password,
          hostKeyFingerprint: conn.spec.hostKeyFingerprint,
          readOnly: false,
        });
        children.set(key(ctx.userId, ctx.connectionId), child);
        const raw = (await child.client.callTool({ name: "get_system_identity", arguments: {} })) as {
          content?: { type: string; text?: string }[];
          isError?: boolean;
        };
        if (raw.isError) return { ok: false, detail: "probe identitas router mengembalikan error" };
        const text = (raw.content ?? []).map((c) => (c.type === "text" ? c.text ?? "" : "")).join("\n");
        if (!text.trim()) return { ok: false, detail: "probe identitas router kosong" };
        return { ok: true, detail: "manajemen router menjawab pembacaan identitas" };
      } catch (err) {
        return { ok: false, detail: err instanceof Error ? err.message : String(err) };
      }
    },

    /** Drop the cached child reference (e.g. on disconnect). */
    forget(userId: string, connectionId: string) {
      children.delete(`${userId}:${connectionId}`);
    },
  };
}
