import { z } from "zod";
import { parseValueList } from "../output-parser";
import type { CustomTool, ToolContext, ToolResult } from "../executor";
import { command, makeManifest } from "./common";

/* ------------------------------------------------------------------ */
/* /lte                                                                 */
/* ------------------------------------------------------------------ */

const LteSchema = z.object({});

export const listLteTool: CustomTool = {
  manifest: makeManifest({
    id: "custom_list_lte",
    description: "List interface LTE/modem seluler (`/interface lte print` + `lte info`), termasuk info SIM/sinyal. Read-only. Package lte wajib terpasang.",
    commandPath: "/lte",
    capabilities: ["lte-package"],
    inputSchema: LteSchema,
  }),
  async run(_input, ctx: ToolContext): Promise<ToolResult> {
    const has = await ctx.executor.hasMenu("/interface lte");
    if (!has) {
      return { ok: false, error: { code: "TOOL_UNSUPPORTED", message: "Modem/package LTE tidak tersedia pada router ini." } };
    }
    const ifaces = await ctx.executor.exec(command().menu("interface", "lte").op("print").flag("detail").build());
    const info = await ctx.executor.exec(command().menu("interface", "lte", "info").build());
    return {
      ok: true,
      data: {
        interfaces: parseValueList(ctx.redact(ifaces.stdout)).rows,
        info: ctx.redact(info.stdout),
      },
    };
  },
};
