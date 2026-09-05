import type { McpSupervisor } from "../mcp/supervisor";
import type { ConnectorService } from "../services/connector";
import type { Logger } from "../lib/logger";

/**
 * Executes dispatched tools on the user's supervised mikrotik-mcp child
 * process (M7). The policy dispatcher has ALREADY validated + authorized the
 * call; this is the single execution path for provider-driven tool calls.
 * Router output is returned raw here — redaction happens in the agent loop.
 */
export function createToolExecutor(deps: {
  supervisor: McpSupervisor;
  connectors: ConnectorService;
  logger: Logger;
}) {
  return async function executeTool(input: {
    userId: string;
    connectionId: string;
    fqName: string;
    args: unknown;
  }): Promise<{ ok: boolean; output: string; errorCode?: string }> {
    const conn = await deps.connectors.requireOwned(input.userId, input.connectionId)();
    const password = await deps.connectors.decryptCredential(input.userId, input.connectionId);
    const { readOnly } = await deps.connectors.getMode(input.userId, input.connectionId).then((m) => ({ readOnly: m.mode === "read-only" }));
    const child = await deps.supervisor.getOrSpawn({
      connectionId: input.connectionId,
      userId: input.userId,
      host: conn.host,
      port: conn.port,
      username: conn.username,
      password,
      hostKeyFingerprint: conn.hostKeyFingerprint,
      readOnly,
    });
    // strip the namespace prefix: mt:tool / docs:tool / custom:tool → tool
    const rawName = input.fqName.includes(":") ? input.fqName.split(":")[1]! : input.fqName;
    try {
      const res = (await child.client.callTool({
        name: rawName,
        arguments: (input.args ?? {}) as Record<string, unknown>,
      })) as { content?: { type: string; text?: string }[]; isError?: boolean };
      const text = (res.content ?? []).map((c) => (c.type === "text" ? c.text ?? "" : "")).join("\n");
      if (res.isError) return { ok: false, output: text || "tool error", errorCode: "TOOL_FAILED" };
      return { ok: true, output: text };
    } catch (err) {
      deps.logger.warn("tool execution failed", { fqName: input.fqName, error: err instanceof Error ? err.message : String(err) });
      return { ok: false, output: err instanceof Error ? err.message : String(err), errorCode: "TOOL_FAILED" };
    }
  };
}

export type ToolExecutor = ReturnType<typeof createToolExecutor>;
