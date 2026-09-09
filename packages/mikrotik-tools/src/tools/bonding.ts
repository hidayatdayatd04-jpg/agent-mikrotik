import { z } from "zod";
import type { CustomTool, ToolContext, ToolResult } from "../executor";
import { command, makeManifest, runPrint } from "./common";

/* ------------------------------------------------------------------ */
/* /interface bonding                                                   */
/* ------------------------------------------------------------------ */

const BondingSchema = z.object({
  name: z.string().regex(/^[a-zA-Z0-9._-]+$/).max(64).optional().describe("Filter berdasarkan nama bonding"),
});

export const listBondingTool: CustomTool = {
  manifest: makeManifest({
    id: "custom_list_bonding_interfaces",
    description: "List interface bonding (`/interface bonding print`) — agregasi link Ethernet. Read-only.",
    commandPath: "/interface bonding",
    capabilities: ["interface-bonding"],
    inputSchema: BondingSchema,
  }),
  async run(input, ctx: ToolContext): Promise<ToolResult> {
    const parsed = BondingSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: { code: "VALIDATION_FAILED", message: "Input tidak valid." } };
    const cmd = command().menu("interface", "bonding").op("print").flag("detail");
    if (parsed.data.name) cmd.where("name", parsed.data.name);
    return runPrint(ctx, cmd.build(), "/interface bonding");
  },
};
