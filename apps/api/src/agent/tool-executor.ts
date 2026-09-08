import type { McpSupervisor } from "../mcp/supervisor";
import type { ConnectorService } from "../services/connector";
import type { Logger } from "../lib/logger";
import { executeNetworkMapTool, NETWORK_MAP_FQ } from "./network-map-tool";
import type { NetworkMapService } from "../services/network-map";
import { tryExecuteCustomTool } from "./tool-executor/custom";
import { executeViaMcp } from "./tool-executor/mcp";

export { ToolTimeoutError } from "./tool-executor/timeout";
export type { OwnedConnection, ToolExecDeps, ToolExecInput, ToolExecResult } from "./tool-executor/types";

/**
 * Executes dispatched tools on the user's supervised mikrotik-mcp child
 * process (M7). The policy dispatcher has ALREADY validated + authorized the
 * call; this is the single execution path for provider-driven tool calls.
 * Router output is returned raw here — redaction happens in the agent loop.
 *
 * Setiap eksekusi dibatasi timeout agar satu tool yang menggantung tidak
 * menahan run melewati deadline. Timeout mutasi bersifat ambigu (status tidak
 * pasti) — pemanggil TIDAK BOLEH mengulang mutasi yang timeout tanpa
 * verifikasi baca terlebih dahulu.
 */
export const TOOL_TIMEOUT_MS = 45_000;

export function createToolExecutor(deps: {
  supervisor: McpSupervisor;
  connectors: ConnectorService;
  logger: Logger;
  timeoutMs?: number;
  networkMap?: NetworkMapService;
}) {
  const timeoutMs = deps.timeoutMs ?? TOOL_TIMEOUT_MS;
  return async function executeTool(input: {
    userId: string;
    connectionId: string;
    fqName: string;
    args: unknown;
    /** Set only by the dispatcher for a read outside an active transaction. */
    retryRead?: boolean;
  }): Promise<{ ok: boolean; output: string; errorCode?: string }> {
    if (input.fqName === NETWORK_MAP_FQ && deps.networkMap) return executeNetworkMapTool(deps.networkMap, input);
    const conn = await deps.connectors.requireOwned(input.userId, input.connectionId)();
    const password = await deps.connectors.decryptCredential(input.userId, input.connectionId);
    const { readOnly } = await deps.connectors.getMode(input.userId, input.connectionId).then((m) => ({ readOnly: m.mode === "read-only" }));

    // strip the namespace prefix: mt:tool / docs:tool / custom:tool → tool
    const rawName = input.fqName.includes(":") ? input.fqName.split(":")[1]! : input.fqName;

    // Execute custom in-process tools if matched
    const custom = await tryExecuteCustomTool({
      rawName,
      fqName: input.fqName,
      args: input.args,
      conn,
      password,
      timeoutMs,
      logger: deps.logger,
    });
    if (custom) return custom;

    return executeViaMcp(
      { supervisor: deps.supervisor, logger: deps.logger, timeoutMs },
      { ...input, rawName },
      { conn, password, readOnly },
    );
  };
}

export type ToolExecutor = ReturnType<typeof createToolExecutor>;
