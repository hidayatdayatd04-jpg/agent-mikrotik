import { addNode, disabled, inSubnet, invalid, ipv4Subnet, linkNodes, macAddress, nodeId, type ModelCtx } from "./helpers";

/** Section subnet/address + klien ARP/DHCP/neighbor (identitas MAC per interface). */
export function buildClientSection(ctx: ModelCtx): void {
  const { tables } = ctx;
  const ifaces = ctx.ifaces;
  for (const row of tables.addresses ?? []) {
    if (!row.address) continue;
    const iface = row["actual-interface"] || row.interface || "";
    const parent = ifaces.get(iface);
    if (parent && !parent.ips.includes(row.address)) parent.ips.push(row.address);
    const cidr = ipv4Subnet(row.address);
    if (!cidr) continue;
    const key = nodeId("subnet", `${iface}:${cidr}`);
    let node = ctx.nodes.get(key);
    if (!node) {
      node = addNode(ctx, { id: key, kind: "subnet", label: cidr, status: "unknown", statusReason: "Subnet dikonfigurasi; ketersediaan klien tidak diketahui.",
        sources: ["configuration"], ips: [row.address], mac: null, interfaceName: iface || null, vlanId: parent?.vlanId ?? null,
        details: { network: row.network ?? cidr, "router-address": row.address, "address-disabled": disabled(row), "address-invalid": invalid(row) },
      });
      ctx.subnets.push({ node, iface, cidr, valid: !disabled(row) && !invalid(row) });
      if (parent) linkNodes(ctx, parent.id, key, "IP / subnet", "configuration");
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
      const key = nodeId("client", `${iface}:${mac || ip}`);
      let node = ctx.nodes.get(key);
      if (!node) node = addNode(ctx, { id: key, kind: "client", label: row["host-name"] || row.identity || ip || mac!, status: "unknown",
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
      const evidence = source === "dhcp" ? "inferred" : source;
      if (parent) linkNodes(ctx, parent.id, node.id, source === "dhcp" ? "DHCP server (inferensi)" : source === "arp" ? "ARP pada interface" : "Neighbor pada interface", evidence);
      const candidates = ip && iface ? ctx.subnets.filter(s => s.valid && s.iface === iface && inSubnet(ip, s.cidr)) : [];
      if (candidates.length === 1) linkNodes(ctx, candidates[0]!.node.id, node.id, "Kecocokan IP (inferensi)", "inferred");
      if (!iface) node.details["attachment-note"] = "Interface / VLAN tidak dapat dipastikan.";
    }
  }
}
