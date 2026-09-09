import type { CustomTool } from "./executor";
import type { ToolManifest } from "./types";
import { listBondingTool } from "./tools/bonding";
import { listNeighborDiscoveryTool } from "./tools/discovery";
import { listMplsTool } from "./tools/mpls";
import { listLteTool } from "./tools/lte";
import { listGpsTool } from "./tools/gps";
import { listSmbTool } from "./tools/smb";
import { listSnmpTool } from "./tools/snmp";

export { listBondingTool } from "./tools/bonding";
export { listNeighborDiscoveryTool } from "./tools/discovery";
export { listMplsTool } from "./tools/mpls";
export { listLteTool } from "./tools/lte";
export { listGpsTool } from "./tools/gps";
export { listSmbTool } from "./tools/smb";
export { listSnmpTool } from "./tools/snmp";

/**
 * Custom tools closing the §4.1 inventory gaps that upstream has no tool for:
 * bonding, neighbor discovery, MPLS, LTE, GPS, SMB, SNMP (all list/get read-only).
 * Namespaced `custom_*` to avoid collisions with upstream; they run through the
 * same policy dispatcher, audit, and rate limit as upstream tools.
 */

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
