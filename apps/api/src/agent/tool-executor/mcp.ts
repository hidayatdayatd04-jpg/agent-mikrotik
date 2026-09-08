import type { McpSupervisor } from "../../mcp/supervisor";
import type { Logger } from "../../lib/logger";
import { isMcpConnectionError } from "../../mcp/recovery";
import { ToolTimeoutError, withTimeout } from "./timeout";
import type { OwnedConnection, ToolExecResult } from "./types";

/** Jalur MCP: panggil tool via supervised mikrotik-mcp child process (M7). */
export async function executeViaMcp(
  env: { supervisor: McpSupervisor; logger: Logger; timeoutMs: number },
  input: {
    userId: string;
    connectionId: string;
    fqName: string;
    rawName: string;
    args: unknown;
    /** Set only by the dispatcher for a read outside an active transaction. */
    retryRead?: boolean;
  },
  link: { conn: OwnedConnection; password: string; readOnly: boolean },
): Promise<ToolExecResult> {
  const { supervisor, logger, timeoutMs } = env;
  const { conn, password, readOnly } = link;
  const { rawName } = input;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const child = await supervisor.getOrSpawn({
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
        await supervisor.stop(input.userId, input.connectionId).catch(() => {});
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
        logger.warn("MCP connection interrupted", { fqName: input.fqName, attempt, error: err instanceof Error ? err.message : String(err) });
        await supervisor.stop(input.userId, input.connectionId).catch(() => {});
        if (input.retryRead && attempt === 0) continue;
        return { ok: false, output: input.retryRead
          ? "Koneksi router masih terputus setelah sistem mencoba menyambungkan ulang. Pastikan router menyala dan SSH dapat dijangkau."
          : "Koneksi terputus saat menjalankan tool. Status perubahan perlu diverifikasi dengan pembacaan sebelum perintah diulang.", errorCode: "SSH_UNREACHABLE" };
      }
      if (err instanceof ToolTimeoutError) {
        logger.warn("tool execution timed out", { fqName: input.fqName, timeoutMs });
        await supervisor.stop(input.userId, input.connectionId).catch(() => {});
        if (input.retryRead && attempt === 0) continue;
        return {
          ok: false,
          output: `Tool "${rawName}" tidak selesai dalam ${Math.round(timeoutMs / 1000)} detik — status tidak pasti. Sesi telah di-recycle agar router tidak terkunci.`,
          errorCode: "TOOL_TIMEOUT",
        };
      }
      logger.warn("tool execution failed", { fqName: input.fqName, error: err instanceof Error ? err.message : String(err) });
      return { ok: false, output: err instanceof Error ? err.message : String(err), errorCode: "TOOL_FAILED" };
    }
  }
  return { ok: false, output: "Koneksi router belum pulih.", errorCode: "SSH_UNREACHABLE" };
}
