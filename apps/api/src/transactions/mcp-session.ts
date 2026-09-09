import type { McpChild } from "../mcp/supervisor";
import { openSession } from "./safe-session-open";
import { openVerifiedSession, verifyManagement } from "./safe-session-verify";
import type { SafeModeSessionFactoryDeps, SafeSessionState } from "./safe-session-types";

export type { SafeModeSessionContext } from "./safe-session-types";

/**
 * SafeModeSession backed by the user's supervised mikrotik-mcp child process.
 *
 * The lifecycle tools (enable/commit/rollback_safe_mode) are upstream MCP tools;
 * the policy dispatcher denies them for model calls — only this adapter, driven
 * by the TransactionCoordinator, may invoke them. All calls go through the SAME
 * child process so the persistent safe-mode shell session stays bound to one
 * connection, as required by the integration contract.
 */
export function createSafeModeSessionFactory(deps: SafeModeSessionFactoryDeps) {
  const state: SafeSessionState = {
    deps,
    children: new Map<string, McpChild>(),
    probeTimeoutMs: deps.probeTimeoutMs ?? 25_000,
  };

  return {
    /** Open (or reuse) the write-mode child for this connection. */
    openSession: (ctx: Parameters<typeof openSession>[1]) => openSession(state, ctx),
    openVerifiedSession: (ctx: Parameters<typeof openVerifiedSession>[1]) => openVerifiedSession(state, ctx),
    verifyManagement: (ctx: Parameters<typeof verifyManagement>[1]) => verifyManagement(state, ctx),
    /** Drop the cached child reference (e.g. on disconnect). */
    forget(userId: string, connectionId: string) {
      state.children.delete(`${userId}:${connectionId}`);
    },
  };
}
