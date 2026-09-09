import { z } from "zod";
import { parseValueList } from "../output-parser";
import type { CustomTool, ToolContext, ToolResult } from "../executor";
import { command, makeManifest } from "./common";

/* ------------------------------------------------------------------ */
/* /smb                                                                 */
/* ------------------------------------------------------------------ */

const SmbSchema = z.object({});

export const listSmbTool: CustomTool = {
  manifest: makeManifest({
    id: "custom_list_smb",
    description: "List pengaturan & share SMB (`/ip smb print`, enabled interfaces, shares). Read-only. Package smb wajib terpasang.",
    commandPath: "/smb",
    capabilities: ["smb-package"],
    inputSchema: SmbSchema,
  }),
  async run(_input, ctx: ToolContext): Promise<ToolResult> {
    const has = await ctx.executor.hasMenu("/ip smb");
    if (!has) {
      return { ok: false, error: { code: "TOOL_UNSUPPORTED", message: "Package SMB tidak tersedia pada router ini." } };
    }
    const settings = await ctx.executor.exec(command().menu("ip", "smb").op("print").build());
    const shares = await ctx.executor.exec(command().menu("ip", "smb", "shares").op("print").build());
    return {
      ok: true,
      data: {
        settings: parseValueList(ctx.redact(settings.stdout)).rows,
        shares: parseValueList(ctx.redact(shares.stdout)).rows,
      },
    };
  },
};
