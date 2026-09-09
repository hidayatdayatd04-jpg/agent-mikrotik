import type { NetworkStatus } from "@shared/network-map";
import { addNode, disabled, invalid, linkNodes, macAddress, no, nodeId, split, yes, type ModelCtx } from "./helpers";

/** Section interface/bridge/VLAN/ports + subnet + DHCP server. */
export function buildInterfaceSection(ctx: ModelCtx): void {
  const { tables } = ctx;
  const ifaces = ctx.ifaces;
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
    const node = addNode(ctx, { id: nodeId("if", name), kind, label: name, status,
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
    linkNodes(ctx, bridge.id, port.id, disabled(row) ? "Bridge port disabled" : "Bridge port", "configuration");
    parented.add(port.id);
    port.details.bridge = row.bridge!;
    port.details.pvid = row.pvid ?? null;
    port.details["bridge-port-disabled"] = disabled(row);
    // PVID alone does NOT establish a VLAN interface or client VLAN membership.
  }
  for (const [name, row] of vlanRows) {
    const vlan = ifaces.get(name)!, parent = ifaces.get(row.interface ?? "");
    if (parent) { linkNodes(ctx, parent.id, vlan.id, `VLAN ${row["vlan-id"] ?? "?"}`, "configuration"); parented.add(vlan.id); }
    else ctx.warnings.push(`Parent VLAN ${name} tidak tersedia; hubungan uplink tidak dapat dipastikan.`);
  }
  for (const node of ifaces.values()) if (!parented.has(node.id)) linkNodes(ctx, "router", node.id, "Interface router", "configuration");
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
}
