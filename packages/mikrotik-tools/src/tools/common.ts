import { z } from "zod";
import { command } from "../command-builder";
import { parseValueList, detectError } from "../output-parser";
import type { ToolContext, ToolResult } from "../executor";
import { TOOL_RISK, type ToolManifest } from "../types";

export function makeManifest(partial: {
  id: string;
  description: string;
  commandPath: string;
  capabilities: string[];
  inputSchema: z.ZodTypeAny;
}): ToolManifest {
  return {
    id: partial.id,
    version: "1.0.0",
    origin: "custom",
    description: partial.description,
    inputSchema: partial.inputSchema,
    risk: TOOL_RISK.READ_ONLY,
    capabilities: partial.capabilities,
    timeoutMs: 20_000,
    idempotent: true,
    sensitiveFields: [],
    recoveryStrategy: "read-only; no recovery needed — re-run to refresh state",
    commandPath: partial.commandPath,
  };
}

export async function runPrint(
  ctx: ToolContext,
  cmd: string,
  menu: string,
): Promise<ToolResult> {
  const has = await ctx.executor.hasMenu(menu);
  if (!has) {
    return {
      ok: false,
      error: {
        code: "TOOL_UNSUPPORTED",
        message: `Menu ${menu} tidak tersedia pada router ini (package/kemampuan tidak ada).`,
      },
    };
  }
  const { stdout, stderr } = await ctx.executor.exec(cmd);
  const err = detectError(`${stdout}\n${stderr}`);
  if (err) return { ok: false, error: { code: "EXEC_ERROR", message: ctx.redact(err) } };
  const parsed = parseValueList(ctx.redact(stdout));
  if (!parsed.ok && parsed.error) {
    return { ok: false, error: { code: "EXEC_ERROR", message: ctx.redact(parsed.error) } };
  }
  return { ok: true, data: { rows: parsed.rows } };
}

export { command };
