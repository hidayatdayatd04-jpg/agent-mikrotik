import { z } from "zod";
import type { CustomTool, ToolContext, ToolResult } from "../executor";
import { command, makeManifest, runPrint } from "./common";

/* ------------------------------------------------------------------ */
/* /mpls                                                                */
/* ------------------------------------------------------------------ */

const MplsSchema = z.object({
  section: z.enum(["settings", "interface", "ldp", "ldp-neighbor", "vpn-vrf"]).default("settings"),
});

export const listMplsTool: CustomTool = {
  manifest: makeManifest({
    id: "custom_list_mpls",
    description: "List konfigurasi MPLS (`/mpls print`, interface, LDP, neighbor, VRF). Read-only. Package mpls wajib terpasang.",
    commandPath: "/mpls",
    capabilities: ["mpls-package"],
    inputSchema: MplsSchema,
  }),
  async run(input, ctx: ToolContext): Promise<ToolResult> {
    const parsed = MplsSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: { code: "VALIDATION_FAILED", message: "Input tidak valid." } };
    const has = await ctx.executor.hasMenu("/mpls");
    if (!has) {
      return { ok: false, error: { code: "TOOL_UNSUPPORTED", message: "Package MPLS tidak tersedia pada router ini." } };
    }
    const section = parsed.data.section;
    const cmd =
      section === "settings"
        ? command().menu("mpls").op("print").build()
        : section === "interface"
          ? command().menu("mpls", "interface").op("print").build()
          : section === "ldp"
            ? command().menu("mpls", "ldp").op("print").build()
            : section === "ldp-neighbor"
              ? command().menu("mpls", "ldp-neighbor").op("print").build()
              : command().menu("mpls", "vpn-vrf").op("print").build();
    return runPrint(ctx, cmd, "/mpls");
  },
};
