import { CUSTOM_TOOLS, type RouterOsExecutor, type ToolContext } from "@mikrotik-tools/index";
import { redactText } from "../../lib/redaction";
import { sshExec } from "../../services/ssh-exec";
import type { Logger } from "../../lib/logger";
import { ToolTimeoutError, withTimeout } from "./timeout";
import type { OwnedConnection, ToolExecResult } from "./types";

/**
 * Cabang custom in-process tools (SSH langsung). Mengembalikan `null` bila
 * tidak ada custom tool yang cocok — pemanggil lanjut ke jalur MCP.
 */
export async function tryExecuteCustomTool(input: {
  rawName: string;
  fqName: string;
  args: unknown;
  conn: OwnedConnection;
  password: string;
  timeoutMs: number;
  logger: Logger;
}): Promise<ToolExecResult | null> {
  const { rawName, conn, password, timeoutMs } = input;
  const logger = input.logger;
  // Execute custom in-process tools if matched
  const customTool = CUSTOM_TOOLS.find((t) => t.manifest.id === rawName);
  if (!customTool) return null;
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
      logger.warn("custom tool execution timed out", { fqName: input.fqName, timeoutMs });
      return {
        ok: false,
        output: `Tool "${rawName}" timed out.`,
        errorCode: "TOOL_TIMEOUT",
      };
    }
    logger.warn("custom tool execution failed", { fqName: input.fqName, error: err instanceof Error ? err.message : String(err) });
    return { ok: false, output: err instanceof Error ? err.message : String(err), errorCode: "TOOL_FAILED" };
  }
}
