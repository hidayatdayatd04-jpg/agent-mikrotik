import { z } from "zod";
import { parseValueList } from "../output-parser";
import type { CustomTool, ToolContext, ToolResult } from "../executor";
import { command, makeManifest } from "./common";

/* ------------------------------------------------------------------ */
/* /gps                                                                 */
/* ------------------------------------------------------------------ */

const GpsSchema = z.object({});

export const listGpsTool: CustomTool = {
  manifest: makeManifest({
    id: "custom_list_gps",
    description: "Baca posisi GPS router (`/system gps print` + monitor). Read-only. Hardware GPS wajib ada.",
    commandPath: "/gps",
    capabilities: ["gps-hardware"],
    inputSchema: GpsSchema,
  }),
  async run(_input, ctx: ToolContext): Promise<ToolResult> {
    const has = await ctx.executor.hasMenu("/system gps");
    if (!has) {
      return { ok: false, error: { code: "TOOL_UNSUPPORTED", message: "GPS tidak tersedia pada router ini." } };
    }
    const settings = await ctx.executor.exec(command().menu("system", "gps").op("print").build());
    const monitor = await ctx.executor.exec(command().menu("system", "gps").op("monitor").op("once").build());
    return {
      ok: true,
      data: {
        settings: parseValueList(ctx.redact(settings.stdout)).rows,
        monitor: ctx.redact(monitor.stdout),
      },
    };
  },
};
