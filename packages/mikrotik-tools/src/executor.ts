/**
 * Executor contract for custom tools. The backend injects the connector-owned
 * SSH/MCP session — tools never open their own connections for mutations,
 * and never see router credentials.
 */
export interface RouterOsExecutor {
  /** Runs one RouterOS CLI command string built via command-builder. */
  exec(command: string, opts?: { timeoutMs?: number; /** inside a safe-mode transaction */ transactionId?: string }): Promise<{ stdout: string; stderr: string }>;
  /** Reports capability of the target (e.g. packages installed). */
  hasMenu(menu: string): Promise<boolean>;
}

export interface ToolContext {
  executor: RouterOsExecutor;
  /** redaction callback applied to tool output before persisting/returning */
  redact: (text: string) => string;
}

export interface ToolResult {
  ok: boolean;
  data?: unknown;
  error?: { code: string; message: string };
}

export interface CustomTool {
  manifest: import("./index").ToolManifest;
  run(input: unknown, ctx: ToolContext): Promise<ToolResult>;
}
