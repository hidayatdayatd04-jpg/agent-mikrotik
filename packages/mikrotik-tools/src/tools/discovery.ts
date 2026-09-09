import { z } from "zod";
import { parseValueList } from "../output-parser";
import type { CustomTool, ToolContext, ToolResult } from "../executor";
import { command, makeManifest } from "./common";

/* ------------------------------------------------------------------ */
/* /ip neighbor discovery                                               */
/* ------------------------------------------------------------------ */

const DiscoverySchema = z.object({});

export const listNeighborDiscoveryTool: CustomTool = {
  manifest: makeManifest({
    id: "custom_list_neighbor_discovery",
    description: "List pengaturan neighbor discovery per interface (`/ip neighbor discovery-settings print` + discovery print). Read-only.",
    commandPath: "/ip neighbor discovery",
    capabilities: ["neighbor-discovery"],
    inputSchema: DiscoverySchema,
  }),
  async run(_input, ctx: ToolContext): Promise<ToolResult> {
    const settings = await ctx.executor.exec(command().menu("ip", "neighbor", "discovery-settings").op("print").build());
    const perIf = await ctx.executor.exec(command().menu("ip", "neighbor", "discovery").op("print").build());
    return {
      ok: true,
      data: {
        settings: parseValueList(ctx.redact(settings.stdout)).rows,
        interfaces: parseValueList(ctx.redact(perIf.stdout)).rows,
      },
    };
  },
};
