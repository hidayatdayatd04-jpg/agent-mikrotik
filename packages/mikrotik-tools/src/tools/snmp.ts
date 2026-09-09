import { z } from "zod";
import { parseValueList } from "../output-parser";
import type { CustomTool, ToolContext, ToolResult } from "../executor";
import { command, makeManifest } from "./common";

/* ------------------------------------------------------------------ */
/* /snmp                                                                */
/* ------------------------------------------------------------------ */

const SnmpSchema = z.object({});

export const listSnmpTool: CustomTool = {
  manifest: makeManifest({
    id: "custom_list_snmp",
    description: "List pengaturan SNMP (`/snmp print`, communities — nilai community di-redaksi). Read-only. Package snmp wajib terpasang.",
    commandPath: "/snmp",
    capabilities: ["snmp-package"],
    inputSchema: SnmpSchema,
  }),
  async run(_input, ctx: ToolContext): Promise<ToolResult> {
    const has = await ctx.executor.hasMenu("/snmp");
    if (!has) {
      return { ok: false, error: { code: "TOOL_UNSUPPORTED", message: "Package SNMP tidak tersedia pada router ini." } };
    }
    const settings = await ctx.executor.exec(command().menu("snmp").op("print").build());
    const communities = await ctx.executor.exec(command().menu("snmp", "communities").op("print").build());
    return {
      ok: true,
      data: {
        settings: parseValueList(ctx.redact(settings.stdout)).rows,
        // communities output goes through redaction so the secret is masked
        communities: parseValueList(ctx.redact(communities.stdout)).rows,
      },
    };
  },
};
