import type { SafeModeSession, TransactionContext } from "./coordinator";
import type { McpSupervisor, McpChild } from "../mcp/supervisor";
import type { Logger } from "../lib/logger";

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
}) {
  const children = new Map<string, McpChild>();

  function key(userId: string, connectionId: string) {
    return `${userId}:${connectionId}`;
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
        };
        return res.content?.map((c) => (c.type === "text" ? c.text ?? "" : "")).join("\n") ?? "";
      };

      const session: SafeModeSession = {
        async enable() {
          await call("enable_safe_mode");
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
            if (text.includes("inactive") || text.includes("disabled") || text.includes("not") || text.includes("off")) {
              return "closed" as const;
            }
            if (text.includes("active") || text.includes("enabled") || text.includes("on")) {
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

    /** Drop the cached child reference (e.g. on disconnect). */
    forget(userId: string, connectionId: string) {
      children.delete(`${userId}:${connectionId}`);
    },
  };
}
