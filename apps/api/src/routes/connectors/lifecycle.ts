import type { Hono } from "hono";
import type { Env } from "../../types";
import type { ConnectorService } from "../../services/connector";
import type { McpSupervisor } from "../../mcp/supervisor";
import type { TransactionCoordinator } from "../../transactions/coordinator";
import type { Logger } from "../../lib/logger";
import { requireWorkspace } from "../../middleware/session";
import { ModeSchema, validateJson } from "./validation";

export interface ConnectorLifecycleDeps {
  connectors: ConnectorService;
  supervisor: McpSupervisor;
  txCoordinator: TransactionCoordinator;
  safeModeSessions: { forget(userId: string, connectionId: string): void };
  logger: Logger;
  invalidateCatalog: () => void;
}

/** Connect/disconnect/mode/delete + pembersihan transaksi. */
export function registerConnectorLifecycle(routes: Hono<Env>, deps: ConnectorLifecycleDeps) {
  /**
   * Disconnect closes this connection's transactions; delete also closes this
   * user's transactions on other connectors for the same verified router.
   */
  async function cleanupTransactions(userId: string, connectionId: string, removing = false) {
    try {
      const active = await deps.txCoordinator.activeTransactionsForRouter(
        (await deps.connectors.requireOwned(userId, connectionId)()).routerIdentity ?? "",
      );
      for (const tx of active) {
        if (tx.lockOwner !== userId || (!removing && tx.connectionId !== connectionId)) continue;
        if (tx.state === "active" || tx.state === "verifying" || tx.state === "preparing") {
          const r = await deps.txCoordinator.forceRollback(tx.id, userId);
          deps.logger.info("transaction force-rolled back on disconnect", { transactionId: tx.id, state: r.state });
        }
      }
    } catch (err) {
      deps.logger.warn("transaction cleanup on disconnect failed", {
        connectionId,
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      deps.safeModeSessions.forget(userId, connectionId);
    }
  }

  routes.post("/:id/connect", async (c) => {
    const workspace = requireWorkspace(c);
    const connector = await deps.connectors.connect(workspace.userId, c.req.param("id"));
    return c.json({ connector });
  });

  routes.post("/:id/disconnect", async (c) => {
    const workspace = requireWorkspace(c);
    // stop the supervised MCP process and revoke write; any live transaction
    // on this connection is force-rolled-back first (safe revert)
    await cleanupTransactions(workspace.userId, c.req.param("id"));
    await deps.supervisor.stop(workspace.userId, c.req.param("id"));
    const connector = await deps.connectors.disconnect(workspace.userId, c.req.param("id"));
    return c.json({ connector });
  });

  routes.patch("/:id/mode", validateJson(ModeSchema), async (c) => {
    const workspace = requireWorkspace(c);
    const { mode, expectedVersion } = c.req.valid("json");
    // Write OFF must first roll back any live transaction on this connection:
    // revoke mutations at the source, then flip the mode atomically.
    if (mode === "read-only") {
      try {
        const conn = await deps.connectors.requireOwned(workspace.userId, c.req.param("id"))();
        const active = await deps.txCoordinator.activeTransactionsForRouter(conn.routerIdentity ?? "");
        for (const tx of active) {
          if (tx.connectionId !== c.req.param("id")) continue;
          if (tx.state === "active" || tx.state === "verifying" || tx.state === "preparing") {
            const r = await deps.txCoordinator.forceRollback(tx.id, workspace.userId);
            deps.logger.info("transaction force-rolled back on Write OFF", { transactionId: tx.id, state: r.state });
          }
        }
        deps.safeModeSessions.forget(workspace.userId, c.req.param("id"));
      } catch (err) {
        deps.logger.warn("transaction cleanup on Write OFF failed", {
          connectionId: c.req.param("id"),
          error: err instanceof Error ? err.message : String(err),
        });
      }
      await deps.supervisor.stop(workspace.userId, c.req.param("id"));
    }
    // Enabling Write requires a connected, verified router; revoking it always remains allowed.
    const result = await deps.connectors.setMode(workspace.userId, c.req.param("id"), mode, expectedVersion);
    deps.invalidateCatalog();
    return c.json({ connector: result.connector, version: result.version });
  });

  routes.delete("/:id", async (c) => {
    const workspace = requireWorkspace(c);
    await cleanupTransactions(workspace.userId, c.req.param("id"), true);
    await deps.supervisor.stop(workspace.userId, c.req.param("id"));
    await deps.connectors.remove(workspace.userId, c.req.param("id"));
    return c.json({ ok: true });
  });
}
