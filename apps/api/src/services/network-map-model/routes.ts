import { addNode, disabled, inSubnet, ipNumber, linkNodes, nodeId, yes, type ModelCtx } from "./helpers";

/** Section gateway/default-route + ringkasan VLAN. */
export function buildRouteSection(ctx: ModelCtx): void {
  const { tables } = ctx;
  const ifaces = ctx.ifaces;
  for (const [index, row] of (tables.routes ?? []).entries()) {
    if (row["dst-address"] !== "0.0.0.0/0") continue;
    const gateway = row.gateway || row["immediate-gw"];
    if (!gateway) continue;
    const active = yes(row.active) || !!row._flags?.includes("A");
    const node = addNode(ctx, { id: nodeId("gateway", `${index}:${gateway}`), kind: "gateway", label: `Gateway ${gateway}`, status: "unknown",
      statusReason: "Default route tersedia; konektivitas Internet belum diuji.", sources: ["configuration"],
      ips: ipNumber(gateway) === null ? [] : [gateway], mac: null, interfaceName: null, vlanId: null,
      details: { gateway, "immediate-gw": row["immediate-gw"] ?? null, "gateway-status": row["gateway-status"] ?? null,
        distance: row.distance ?? null, "routing-table": row["routing-table"] || row["routing-mark"] || "main",
        "route-active": active, "route-disabled": disabled(row), "dst-address": row["dst-address"]! },
    });
    linkNodes(ctx, node.id, "router", active ? "Default route aktif" : "Default route tidak aktif", "configuration");
    const immediateIface = row["immediate-gw"]?.split("%")[1];
    const parent = ifaces.get(immediateIface || gateway);
    if (parent) { node.interfaceName = parent.label; node.details["egress-interface"] = parent.label; }
    else {
      const candidates = ctx.subnets.filter(s => s.valid && inSubnet(gateway, s.cidr));
      if (candidates.length === 1) node.details["egress-interface (inferred)"] = candidates[0]!.iface;
    }
  }
  for (const node of ifaces.values()) {
    if (node.kind !== "vlan") continue;
    const clients = [...ctx.nodes.values()].filter(n => n.kind === "client" && n.interfaceName === node.label);
    node.details["detected-client-records"] = clients.length;
    node.details["clients-arp-neighbor"] = clients.filter(n => n.sources.includes("arp") || n.sources.includes("neighbor")).length;
    node.details["clients-dhcp-only (inferred)"] = clients.filter(n => n.sources.length === 1 && n.sources[0] === "dhcp").length;
    node.details.subnets = ctx.subnets.filter(s => s.iface === node.label).map(s => s.cidr).join(", ") || null;
    node.details["router-addresses"] = node.ips.join(", ") || null;
  }
}
