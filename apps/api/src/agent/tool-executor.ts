import type { McpSupervisor } from "../mcp/supervisor";
import type { ConnectorService } from "../services/connector";
import type { Logger } from "../lib/logger";
import { CUSTOM_TOOLS, type RouterOsExecutor, type ToolContext } from "@mikrotik-tools/index";
import { redactText } from "../lib/redaction";
import { sshExec } from "../services/ssh-exec";
import { isMcpConnectionError } from "../mcp/recovery";
import { executeNetworkMapTool, NETWORK_MAP_FQ } from "./network-map-tool";
import type { NetworkMapService } from "../services/network-map";

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
    const customTool = CUSTOM_TOOLS.find((t) => t.manifest.id === rawName);
    if (customTool) {
      try {
        const executor: RouterOsExecutor = {
          async exec(command: string) {
            const res = await sshExec({
              host: conn.host,
              port: conn.port,
              username: conn.username,
              password,
              command,
              timeoutMs: Math.min(20_000, timeoutMs),
            });
            return { stdout: res.output, stderr: "" };
          },
          async hasMenu(menu: string) {
            try {
              const res = await this.exec(`${menu.replace(/^\/?/, "/")} print count-only`);
              const lower = res.stdout.toLowerCase();
              if (lower.includes("bad command") || lower.includes("syntax error") || lower.includes("no such command")) {
                return false;
              }
              return true;
            } catch {
              return false;
            }
          },
        };
        const ctx: ToolContext = {
          executor,
          redact: redactText,
        };
        const result = await withTimeout(customTool.run(input.args, ctx), timeoutMs);
        if (!result.ok) {
          return {
            ok: false,
            output: result.error?.message ?? "Custom tool error",
            errorCode: result.error?.code ?? "TOOL_FAILED",
          };
        }
        const text = typeof result.data === "string" ? result.data : JSON.stringify(result.data, null, 2);
        return { ok: true, output: text };
      } catch (err) {
        if (err instanceof ToolTimeoutError) {
          deps.logger.warn("custom tool execution timed out", { fqName: input.fqName, timeoutMs });
          return {
            ok: false,
            output: `Tool "${rawName}" timed out.`,
            errorCode: "TOOL_TIMEOUT",
          };
        }
        deps.logger.warn("custom tool execution failed", { fqName: input.fqName, error: err instanceof Error ? err.message : String(err) });
        return { ok: false, output: err instanceof Error ? err.message : String(err), errorCode: "TOOL_FAILED" };
      }
    }

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
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
        let callArguments = (input.args ?? {}) as Record<string, unknown>;
        if (
          (rawName === "describe_tool" || rawName === "invoke_tool") &&
          typeof callArguments.name === "string"
        ) {
          callArguments = {
            ...callArguments,
            name: callArguments.name.replace(/^(mt[:_]|docs[:_]|custom[:_]|system[:_])/, ""),
          };
        }
        if (
          rawName === "invoke_tool" &&
          !("name" in callArguments) &&
          "arguments" in callArguments &&
          typeof callArguments.arguments === "object" &&
          callArguments.arguments !== null &&
          "name" in (callArguments.arguments as Record<string, unknown>)
        ) {
          callArguments = callArguments.arguments as Record<string, unknown>;
          if (typeof callArguments.name === "string") {
            callArguments = {
              ...callArguments,
              name: callArguments.name.replace(/^(mt[:_]|docs[:_]|custom[:_]|system[:_])/, ""),
            };
          }
        }
        const res = await withTimeout(
          child.client.callTool({
            name: rawName,
            arguments: callArguments,
          }) as Promise<{ content?: { type: string; text?: string }[]; isError?: boolean }>,
          timeoutMs,
        );
        const text = (res.content ?? []).map((c) => (c.type === "text" ? c.text ?? "" : "")).join("\n");
        const isHungSession = /went silent|appears wedged|timed out/i.test(text);
        if (isHungSession) {
          // Immediately terminate the dead child process to close the half-open TCP socket
          // so RouterOS detects connection drop and Safe Mode automatically rolls back.
          await deps.supervisor.stop(input.userId, input.connectionId).catch(() => {});
          if (input.retryRead && attempt === 0) continue;
          return { ok: false, output: "Koneksi router tidak merespons setelah pemulihan sesi.", errorCode: "SSH_TIMEOUT" };
        }
        if (res.isError) {
          const isAlreadyExists = /already have interface with such name|already have such address|already exists|failure: already have/i.test(text);
          if (isAlreadyExists) {
            return {
              ok: true,
              output: `${text}\n\n[Catatan: Resource ini sudah ada dan aktif di router sebelumnya — konfigurasi tidak perlu dibuat ulang, lanjutkan langkah berikutnya.]`,
            };
          }
          return { ok: false, output: text || "tool error", errorCode: "TOOL_FAILED" };
        }
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
        if (isMcpConnectionError(err)) {
          deps.logger.warn("MCP connection interrupted", { fqName: input.fqName, attempt, error: err instanceof Error ? err.message : String(err) });
          await deps.supervisor.stop(input.userId, input.connectionId).catch(() => {});
          if (input.retryRead && attempt === 0) continue;
          return { ok: false, output: input.retryRead
            ? "Koneksi router masih terputus setelah sistem mencoba menyambungkan ulang. Pastikan router menyala dan SSH dapat dijangkau."
            : "Koneksi terputus saat menjalankan tool. Status perubahan perlu diverifikasi dengan pembacaan sebelum perintah diulang.", errorCode: "SSH_UNREACHABLE" };
        }
        if (err instanceof ToolTimeoutError) {
          deps.logger.warn("tool execution timed out", { fqName: input.fqName, timeoutMs });
          await deps.supervisor.stop(input.userId, input.connectionId).catch(() => {});
          if (input.retryRead && attempt === 0) continue;
          return {
            ok: false,
            output: `Tool "${rawName}" tidak selesai dalam ${Math.round(timeoutMs / 1000)} detik — status tidak pasti. Sesi telah di-recycle agar router tidak terkunci.`,
            errorCode: "TOOL_TIMEOUT",
          };
        }
        deps.logger.warn("tool execution failed", { fqName: input.fqName, error: err instanceof Error ? err.message : String(err) });
        return { ok: false, output: err instanceof Error ? err.message : String(err), errorCode: "TOOL_FAILED" };
      }
    }
    return { ok: false, output: "Koneksi router belum pulih.", errorCode: "SSH_UNREACHABLE" };
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
