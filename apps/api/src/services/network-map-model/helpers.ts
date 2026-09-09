import type { NetworkEdge, NetworkEvidence, NetworkMapSnapshot, NetworkNode } from "@shared/network-map";
import type { NetworkRow, NetworkTables } from "../network-map-reader";

export const yes = (v: string | undefined) => v === "true" || v === "yes";
export const no = (v: string | undefined) => v === "false" || v === "no";
export const disabled = (r: NetworkRow) => yes(r.disabled) || !!r._flags?.includes("X");
export const invalid = (r: NetworkRow) => yes(r.invalid) || !!r._flags?.includes("I");
export const nodeId = (kind: string, name: string) => `${kind}:${encodeURIComponent(name)}`;
export const split = (v: string | undefined) => v?.split(",").map(s => s.trim()).filter(Boolean) ?? [];
export const macAddress = (v: string | undefined) => v && /^(?:[0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(v) && v !== "00:00:00:00:00:00" ? v.toUpperCase() : null;

export function ipNumber(value: string): number | null {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(value)) return null;
  const parts = value.split(".").map(Number);
  if (parts.some(n => n > 255)) return null;
  return parts.reduce((n, part) => ((n << 8) | part) >>> 0, 0);
}

export function ipv4Subnet(address: string): string | null {
  const [ip, prefix] = address.split("/");
  if (!ip || !prefix || !/^\d{1,2}$/.test(prefix)) return null;
  const n = ipNumber(ip), bits = Number(prefix);
  if (n === null || bits > 32) return null;
  const base = (n & (bits === 0 ? 0 : 0xffffffff << (32 - bits))) >>> 0;
  return `${[24, 16, 8, 0].map(shift => (base >>> shift) & 255).join(".")}/${bits}`;
}

export function inSubnet(ip: string, cidr: string): boolean {
  const prefix = cidr.split("/")[1];
  return prefix !== undefined && ipv4Subnet(`${ip}/${prefix}`) === cidr;
}

/** State model bersama yang dimutasi para pembangun section. */
export interface ModelCtx {
  tables: NetworkTables;
  meta: Pick<NetworkMapSnapshot, "connectionId" | "collectedAt" | "datasets"> & { host: string };
  nodes: Map<string, NetworkNode>;
  edges: Map<string, NetworkEdge>;
  warnings: string[];
  ifaces: Map<string, NetworkNode>;
  subnets: { node: NetworkNode; iface: string; cidr: string; valid: boolean }[];
  hasData: boolean;
}

export function createModelCtx(
  tables: NetworkTables,
  meta: Pick<NetworkMapSnapshot, "connectionId" | "collectedAt" | "datasets"> & { host: string },
): ModelCtx {
  return {
    tables,
    meta,
    nodes: new Map<string, NetworkNode>(),
    edges: new Map<string, NetworkEdge>(),
    warnings: [
      "Deteksi pasif IPv4: perangkat di balik switch, NAT, Wi-Fi atau router lain belum tentu terlihat. IPv6 belum dipetakan.",
      "Online berarti status link atau ARP reachable saat snapshot. Lease bound dan neighbor tidak membuktikan perangkat masih online. Default route tidak membuktikan akses Internet.",
    ],
    ifaces: new Map<string, NetworkNode>(),
    subnets: [],
    hasData: Object.values(tables).some(rows => rows && rows.length > 0),
  };
}

export function addNode(ctx: ModelCtx, node: NetworkNode): NetworkNode {
  ctx.nodes.set(node.id, node);
  return node;
}

export function linkNodes(ctx: ModelCtx, source: string, target: string, label: string, evidence: NetworkEvidence): void {
  if (source === target || !ctx.nodes.has(source) || !ctx.nodes.has(target)) return;
  const key = `${source}>${target}:${label}`;
  ctx.edges.set(key, { id: key, source, target, label, evidence });
}
