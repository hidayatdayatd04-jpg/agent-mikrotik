import type { NetworkMapSnapshot } from "@shared/network-map";
import type { NetworkTables } from "./network-map-reader";
import { addNode, createModelCtx } from "./network-map-model/helpers";
import { buildInterfaceSection } from "./network-map-model/interfaces";
import { buildClientSection } from "./network-map-model/clients";
import { buildRouteSection } from "./network-map-model/routes";

export { ipv4Subnet } from "./network-map-model/helpers";

export function buildNetworkMap(tables: NetworkTables, meta: Pick<NetworkMapSnapshot, "connectionId" | "collectedAt" | "datasets"> & { host: string }): NetworkMapSnapshot {
  const ctx = createModelCtx(tables, meta);
  const routerData = tables.identity?.[0];
  const resource = tables.resource?.[0];
  if (ctx.hasData) addNode(ctx, {
    id: "router", kind: "router", label: routerData?.name || "MikroTik", status: "online",
    statusReason: "Router merespons pembacaan SSH pada waktu snapshot.", sources: ["configuration"],
    ips: [meta.host], mac: null, interfaceName: null, vlanId: null,
    details: { identity: routerData?.name ?? null, version: resource?.version ?? null, uptime: resource?.uptime ?? null,
      "cpu-load (%)": resource?.["cpu-load"] ?? null, "free-memory": resource?.["free-memory"] ?? null,
      "total-memory": resource?.["total-memory"] ?? null, "board-name": resource?.["board-name"] ?? null,
      "architecture-name": resource?.["architecture-name"] ?? null, "management-ip": meta.host },
  });

  buildInterfaceSection(ctx);
  buildClientSection(ctx);
  buildRouteSection(ctx);

  for (const ds of meta.datasets) if (ds.status !== "ok") ctx.warnings.push(`${ds.name}: ${ds.status === "truncated" ? "data dibatasi; jumlah terdeteksi merupakan batas bawah" : "tidak tersedia / tidak didukung / izin baca ditolak"}.`);
  const partial = meta.datasets.some(d => d.status !== "ok");
  return { connectionId: meta.connectionId, collectedAt: meta.collectedAt, nodes: [...ctx.nodes.values()], edges: [...ctx.edges.values()], datasets: meta.datasets,
    state: !ctx.hasData ? partial ? "error" : "empty" : partial ? "partial" : "success", cached: false, warnings: ctx.warnings,
    message: !ctx.hasData ? partial ? "Data topologi belum dapat dibaca. Periksa izin baca dan kompatibilitas RouterOS." : "Router belum mengembalikan data topologi." : null };
}
