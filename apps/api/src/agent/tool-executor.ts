import type { McpSupervisor } from "../mcp/supervisor";
import type { ConnectorService } from "../services/connector";
import type { Logger } from "../lib/logger";

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
}) {
  const timeoutMs = deps.timeoutMs ?? TOOL_TIMEOUT_MS;
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
      const res = await withTimeout(
        child.client.callTool({
          name: rawName,
          arguments: (input.args ?? {}) as Record<string, unknown>,
        }) as Promise<{ content?: { type: string; text?: string }[]; isError?: boolean }>,
        timeoutMs,
      );
      const text = (res.content ?? []).map((c) => (c.type === "text" ? c.text ?? "" : "")).join("\n");
      if (res.isError) return { ok: false, output: text || "tool error", errorCode: "TOOL_FAILED" };
      // MCP mengembalikan teks error tanpa isError untuk nama tool yang salah.
      // Tanpa penanda gagal, model mengulang panggilan identik tanpa kemajuan.
      if (/no tool named\b/i.test(text)) {
        return {
          ok: false,
          output: `${text}\n\n[Nama tool salah — pilih nama persis dari daftar tool yang tersedia, jangan menambah prefix atau mengarang nama.]`,
          errorCode: "TOOL_UNSUPPORTED",
        };
      }
      return { ok: true, output: text };
    } catch (err) {
      if (err instanceof ToolTimeoutError) {
        deps.logger.warn("tool execution timed out", { fqName: input.fqName, timeoutMs });
        return {
          ok: false,
          output: `Tool "${rawName}" tidak selesai dalam ${Math.round(timeoutMs / 1000)} detik — status tidak pasti. Jangan ulangi mutasi sebelum verifikasi baca.`,
          errorCode: "TOOL_TIMEOUT",
        };
      }
      deps.logger.warn("tool execution failed", { fqName: input.fqName, error: err instanceof Error ? err.message : String(err) });
      return { ok: false, output: err instanceof Error ? err.message : String(err), errorCode: "TOOL_FAILED" };
    }
  };
}

export class ToolTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`tool timed out after ${timeoutMs}ms`);
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ToolTimeoutError(ms)), ms);
  });
  return Promise.race([promise.then((v) => { clearTimeout(timer); return v; }, (e) => { clearTimeout(timer); throw e; }), timeout]);
}

export type ToolExecutor = ReturnType<typeof createToolExecutor>;
