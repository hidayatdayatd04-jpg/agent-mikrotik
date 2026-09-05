import { z } from "zod";
import { command } from "./command-builder";
import { parseValueList, detectError } from "./output-parser";
import type { CustomTool, ToolContext, ToolResult } from "./executor";
import { TOOL_RISK, type ToolManifest } from "./types";

/**
 * Custom tools closing the §4.1 inventory gaps that upstream has no tool for:
 * bonding, neighbor discovery, MPLS, LTE, GPS, SMB, SNMP (all list/get read-only).
 * Namespaced `custom_*` to avoid collisions with upstream; they run through the
 * same policy dispatcher, audit, and rate limit as upstream tools.
 */

function makeManifest(partial: {
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

async function runPrint(
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

export const CUSTOM_TOOLS: CustomTool[] = [
  listBondingTool,
  listNeighborDiscoveryTool,
  listMplsTool,
  listLteTool,
  listGpsTool,
  listSmbTool,
  listSnmpTool,
];

export function customManifests(): ToolManifest[] {
  return CUSTOM_TOOLS.map((t) => t.manifest);
}
