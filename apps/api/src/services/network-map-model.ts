import type { NetworkEdge, NetworkEvidence, NetworkMapSnapshot, NetworkNode, NetworkStatus } from "@shared/network-map";
import type { NetworkRow, NetworkTables } from "./network-map-reader";

const yes = (v: string | undefined) => v === "true" || v === "yes";
const no = (v: string | undefined) => v === "false" || v === "no";
const disabled = (r: NetworkRow) => yes(r.disabled) || !!r._flags?.includes("X");
const invalid = (r: NetworkRow) => yes(r.invalid) || !!r._flags?.includes("I");
const id = (kind: string, name: string) => `${kind}:${encodeURIComponent(name)}`;
const split = (v: string | undefined) => v?.split(",").map(s => s.trim()).filter(Boolean) ?? [];
const macAddress = (v: string | undefined) => v && /^(?:[0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(v) && v !== "00:00:00:00:00:00" ? v.toUpperCase() : null;

function ipNumber(value: string): number | null {
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
function inSubnet(ip: string, cidr: string): boolean {
  const prefix = cidr.split("/")[1];
  return prefix !== undefined && ipv4Subnet(`${ip}/${prefix}`) === cidr;
}

export function buildNetworkMap(tables: NetworkTables, meta: Pick<NetworkMapSnapshot, "connectionId" | "collectedAt" | "datasets"> & { host: string }): NetworkMapSnapshot {
  const nodes = new Map<string, NetworkNode>();
  const edges = new Map<string, NetworkEdge>();
  const warnings: string[] = ["Deteksi pasif IPv4: perangkat di balik switch, NAT, Wi-Fi atau router lain belum tentu terlihat. IPv6 belum dipetakan."];
  warnings.push("Online berarti status link atau ARP reachable saat snapshot. Lease bound dan neighbor tidak membuktikan perangkat masih online. Default route tidak membuktikan akses Internet.");
  const add = (node: NetworkNode) => { nodes.set(node.id, node); return node; };
  const link = (source: string, target: string, label: string, evidence: NetworkEvidence) => {
    if (source === target || !nodes.has(source) || !nodes.has(target)) return;
    const key = `${source}>${target}:${label}`;
    edges.set(key, { id: key, source, target, label, evidence });
  };
  const routerData = tables.identity?.[0];
  const resource = tables.resource?.[0];
  const hasData = Object.values(tables).some(rows => rows && rows.length > 0);
  if (hasData) add({
    id: "router", kind: "router", label: routerData?.name || "MikroTik", status: "online",
    statusReason: "Router merespons pembacaan SSH pada waktu snapshot.", sources: ["configuration"],
    ips: [meta.host], mac: null, interfaceName: null, vlanId: null,
    details: { identity: routerData?.name ?? null, version: resource?.version ?? null, uptime: resource?.uptime ?? null,
      "cpu-load (%)": resource?.["cpu-load"] ?? null, "free-memory": resource?.["free-memory"] ?? null,
      "total-memory": resource?.["total-memory"] ?? null, "board-name": resource?.["board-name"] ?? null,
      "architecture-name": resource?.["architecture-name"] ?? null, "management-ip": meta.host },
  });

  const ifaces = new Map<string, NetworkNode>();
  const bridgeRows = new Map((tables.bridges ?? []).filter(r => r.name).map(r => [r.name!, r]));
  const vlanRows = new Map((tables.vlans ?? []).filter(r => r.name).map(r => [r.name!, r]));
  const trafficRows = new Map((tables.traffic ?? []).map(r => [r.name, r]));
  const allInterfaces = new Map((tables.interfaces ?? []).filter(r => r.name).map(r => [r.name!, r]));
  for (const [name, row] of [...bridgeRows, ...vlanRows]) if (!allInterfaces.has(name)) allInterfaces.set(name, row);
  for (const [name, row] of allInterfaces) {
    const bridge = bridgeRows.get(name), vlan = vlanRows.get(name), traffic = trafficRows.get(name);
    const kind = bridge || row.type === "bridge" ? "bridge" : vlan || row.type === "vlan" ? "vlan" : "interface";
    const status: NetworkStatus = disabled(row) || invalid(row) ? "offline" : yes(row.running) || row._flags?.includes("R") ? "online"
      : no(row.running) || (tables.interfaces?.includes(row) && row._flags !== undefined) ? "offline" : "unknown";
    const node = add({ id: id("if", name), kind, label: name, status,
      statusReason: disabled(row) ? "Interface dinonaktifkan." : invalid(row) ? "Interface invalid." : status === "online" ? "Interface running; bukan bukti akses Internet." : status === "offline" ? "Interface tidak running saat snapshot." : "Status running tidak tersedia.",
      sources: ["configuration"], ips: [], mac: macAddress(row["mac-address"]), interfaceName: name, vlanId: vlan?.["vlan-id"] ?? null,
      details: { type: row.type ?? kind, mtu: row["actual-mtu"] ?? row.mtu ?? null, "l2-mtu": row.l2mtu ?? null,
        parent: vlan?.interface ?? null, "vlan-filtering": bridge?.["vlan-filtering"] ?? null,
        "rx-byte (counter)": traffic?.["rx-byte"] ?? null, "tx-byte (counter)": traffic?.["tx-byte"] ?? null,
        "rx-packet (counter)": traffic?.["rx-packet"] ?? null, "tx-packet (counter)": traffic?.["tx-packet"] ?? null },
    });
    ifaces.set(name, node);
  }
  const parented = new Set<string>();
  for (const row of tables.ports ?? []) {
    const port = ifaces.get(row.interface ?? ""), bridge = ifaces.get(row.bridge ?? "");
    if (!port || !bridge) continue;
    link(bridge.id, port.id, disabled(row) ? "Bridge port disabled" : "Bridge port", "configuration");
    parented.add(port.id);
    port.details.bridge = row.bridge!;
    port.details.pvid = row.pvid ?? null;
    port.details["bridge-port-disabled"] = disabled(row);
    // PVID alone does NOT establish a VLAN interface or client VLAN membership.
  }
  for (const [name, row] of vlanRows) {
    const vlan = ifaces.get(name)!, parent = ifaces.get(row.interface ?? "");
    if (parent) { link(parent.id, vlan.id, `VLAN ${row["vlan-id"] ?? "?"}`, "configuration"); parented.add(vlan.id); }
    else warnings.push(`Parent VLAN ${name} tidak tersedia; hubungan uplink tidak dapat dipastikan.`);
  }
  for (const node of ifaces.values()) if (!parented.has(node.id)) link("router", node.id, "Interface router", "configuration");
  for (const row of tables.bridgeVlans ?? []) {
    const bridge = ifaces.get(row.bridge ?? "");
    if (!bridge) continue;
    const key = `bridge-vlan ${row["vlan-ids"] ?? "?"}`;
    bridge.details[key] = `tagged=${row["current-tagged"] || row.tagged || "—"}; untagged=${row["current-untagged"] || row.untagged || "—"}; disabled=${disabled(row)}`;
    for (const name of new Set([...split(row.tagged), ...split(row.untagged), ...split(row["current-tagged"]), ...split(row["current-untagged"])])) {
      const port = ifaces.get(name);
      if (port) port.details[key] = bridge.details[key]!;
    }
  }

  const subnets: { node: NetworkNode; iface: string; cidr: string; valid: boolean }[] = [];
  for (const row of tables.addresses ?? []) {
    if (!row.address) continue;
    const iface = row["actual-interface"] || row.interface || "";
    const parent = ifaces.get(iface);
    if (parent && !parent.ips.includes(row.address)) parent.ips.push(row.address);
    const cidr = ipv4Subnet(row.address);
    if (!cidr) continue;
    const key = id("subnet", `${iface}:${cidr}`);
    let node = nodes.get(key);
    if (!node) {
      node = add({ id: key, kind: "subnet", label: cidr, status: "unknown", statusReason: "Subnet dikonfigurasi; ketersediaan klien tidak diketahui.",
        sources: ["configuration"], ips: [row.address], mac: null, interfaceName: iface || null, vlanId: parent?.vlanId ?? null,
        details: { network: row.network ?? cidr, "router-address": row.address, "address-disabled": disabled(row), "address-invalid": invalid(row) },
      });
      subnets.push({ node, iface, cidr, valid: !disabled(row) && !invalid(row) });
      if (parent) link(parent.id, key, "IP / subnet", "configuration");
    } else if (!node.ips.includes(row.address)) node.ips.push(row.address);
  }
  for (const row of tables.dhcpServers ?? []) {
    const parent = ifaces.get(row.interface ?? "");
    if (parent && row.name) parent.details[`DHCP ${row.name}`] = `disabled=${disabled(row)}; relay=${row.relay || "—"}`;
  }

  // Scope MAC identity to the observed logical interface to avoid merging
  // identical/reused MAC addresses across isolated VLANs.
  for (const source of ["arp", "dhcp", "neighbor"] as const) {
    const rows = source === "arp" ? tables.arp : source === "dhcp" ? tables.leases : tables.neighbors;
    for (const row of rows ?? []) {
      if (disabled(row) || invalid(row)) continue;
      if (source === "dhcp" && row.status !== "bound") continue;
      const mac = macAddress(source === "dhcp" ? row["active-mac-address"] || row["mac-address"] : row["mac-address"]);
      // Incomplete/failed ARP without a valid MAC is not a detected device.
      if (!mac && source !== "neighbor") continue;
      const ip = source === "dhcp" ? row["active-address"] || row.address : row.address4 || row.address;
      if (!mac && (!ip || !row.identity)) continue;
      const server = source === "dhcp" ? (tables.dhcpServers ?? []).find(r => r.name === (row["active-server"] || row.server)) : null;
      // A DHCP relay only identifies the server's attachment, not the client's.
      const relayed = !!server?.relay && server.relay !== "0.0.0.0";
      const iface = source === "dhcp" ? relayed ? "" : server?.interface ?? "" : row.interface ?? "";
      const parent = ifaces.get(iface);
      const key = id("client", `${iface}:${mac || ip}`);
      let node = nodes.get(key);
      if (!node) node = add({ id: key, kind: "client", label: row["host-name"] || row.identity || ip || mac!, status: "unknown",
        statusReason: "Ketersediaan saat ini tidak diketahui.", sources: [], ips: [], mac, interfaceName: iface || null,
        vlanId: parent?.vlanId ?? null, details: {},
      });
      node.statusReason = node.status === "online" ? node.statusReason : "Tercatat pada tabel router; ketersediaan saat ini tidak diketahui.";
      if (!node.sources.includes(source)) node.sources.push(source);
      if (ip && !node.ips.includes(ip)) node.ips.push(ip);
      if (row["host-name"] || row.identity) node.label = row["host-name"] || row.identity!;
      if (source === "arp") {
        node.details["arp-status"] = row.status ?? null;
        if (row.status === "reachable") { node.status = "online"; node.statusReason = "ARP berstatus reachable pada waktu snapshot."; }
      }
      if (source === "dhcp") {
        node.details["dhcp-status"] = row.status ?? null;
        node.details["dhcp-server"] = row["active-server"] || row.server || null;
        node.details["expires-after"] = row["expires-after"] ?? null;
        node.details["last-seen"] = row["last-seen"] ?? null;
        node.details["dhcp-relay"] = relayed ? server!.relay! : null;
      }
      if (source === "neighbor") {
        node.details.platform = row.platform ?? null;
        node.details.version = row.version ?? null;
        node.details["remote-interface"] = row["interface-name"] ?? null;
      }
      const evidence: NetworkEvidence = source === "dhcp" ? "inferred" : source;
      if (parent) link(parent.id, node.id, source === "dhcp" ? "DHCP server (inferensi)" : source === "arp" ? "ARP pada interface" : "Neighbor pada interface", evidence);
      const candidates = ip && iface ? subnets.filter(s => s.valid && s.iface === iface && inSubnet(ip, s.cidr)) : [];
      if (candidates.length === 1) link(candidates[0]!.node.id, node.id, "Kecocokan IP (inferensi)", "inferred");
      if (!iface) node.details["attachment-note"] = "Interface / VLAN tidak dapat dipastikan.";
    }
  }

  for (const [index, row] of (tables.routes ?? []).entries()) {
    if (row["dst-address"] !== "0.0.0.0/0") continue;
    const gateway = row.gateway || row["immediate-gw"];
    if (!gateway) continue;
    const active = yes(row.active) || !!row._flags?.includes("A");
    const node = add({ id: id("gateway", `${index}:${gateway}`), kind: "gateway", label: `Gateway ${gateway}`, status: "unknown",
      statusReason: "Default route tersedia; konektivitas Internet belum diuji.", sources: ["configuration"],
      ips: ipNumber(gateway) === null ? [] : [gateway], mac: null, interfaceName: null, vlanId: null,
      details: { gateway, "immediate-gw": row["immediate-gw"] ?? null, "gateway-status": row["gateway-status"] ?? null,
        distance: row.distance ?? null, "routing-table": row["routing-table"] || row["routing-mark"] || "main",
        "route-active": active, "route-disabled": disabled(row), "dst-address": row["dst-address"]! },
    });
    link(node.id, "router", active ? "Default route aktif" : "Default route tidak aktif", "configuration");
    const immediateIface = row["immediate-gw"]?.split("%")[1];
    const parent = ifaces.get(immediateIface || gateway);
    if (parent) { node.interfaceName = parent.label; node.details["egress-interface"] = parent.label; }
    else {
      const candidates = subnets.filter(s => s.valid && inSubnet(gateway, s.cidr));
      if (candidates.length === 1) node.details["egress-interface (inferred)"] = candidates[0]!.iface;
    }
  }
  for (const node of ifaces.values()) {
    if (node.kind !== "vlan") continue;
    const clients = [...nodes.values()].filter(n => n.kind === "client" && n.interfaceName === node.label);
    node.details["detected-client-records"] = clients.length;
    node.details["clients-arp-neighbor"] = clients.filter(n => n.sources.includes("arp") || n.sources.includes("neighbor")).length;
    node.details["clients-dhcp-only (inferred)"] = clients.filter(n => n.sources.length === 1 && n.sources[0] === "dhcp").length;
    node.details.subnets = subnets.filter(s => s.iface === node.label).map(s => s.cidr).join(", ") || null;
    node.details["router-addresses"] = node.ips.join(", ") || null;
  }
  for (const ds of meta.datasets) if (ds.status !== "ok") warnings.push(`${ds.name}: ${ds.status === "truncated" ? "data dibatasi; jumlah terdeteksi merupakan batas bawah" : "tidak tersedia / tidak didukung / izin baca ditolak"}.`);
  const partial = meta.datasets.some(d => d.status !== "ok");
  return { connectionId: meta.connectionId, collectedAt: meta.collectedAt, nodes: [...nodes.values()], edges: [...edges.values()], datasets: meta.datasets,
    state: !hasData ? partial ? "error" : "empty" : partial ? "partial" : "success", cached: false, warnings,
    message: !hasData ? partial ? "Data topologi belum dapat dibaca. Periksa izin baca dan kompatibilitas RouterOS." : "Router belum mengembalikan data topologi." : null };
}
