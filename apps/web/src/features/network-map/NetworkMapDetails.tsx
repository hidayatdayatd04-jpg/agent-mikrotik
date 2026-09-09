import { SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Network, ChevronRight } from "@/components/icons";
import { networkAttachmentPath, type NetworkMapSnapshot, type NetworkNode } from "@shared/network-map";
import { KIND, SOURCE, STATUS, DETAIL_LABELS } from "./NetworkMapMeta";

export function DeviceDetails({ node, snapshot, onChoose }: { node: NetworkNode; snapshot: NetworkMapSnapshot; onChoose: (id: string) => void }) {
  const Icon = KIND[node.kind].icon;
  const relations = snapshot.edges.filter((e) => e.source === node.id || e.target === node.id);
  const byId = new Map(snapshot.nodes.map((n) => [n.id, n]));
  const path = networkAttachmentPath(snapshot, node.id);
  const gateways = snapshot.nodes.filter((n) => n.kind === "gateway" && n.details["route-active"] === true && n.details["route-disabled"] !== true);
  return (
    <>
      <SheetHeader className="map-detail-header">
        <div className="map-detail-identity">
          <span className="map-detail-icon">
            <Icon className="size-6" />
          </span>
          <div className="min-w-0">
            <p className="map-detail-kind">
              {KIND[node.kind].label}
              {node.vlanId ? ` · VLAN ${node.vlanId}` : ""}
            </p>
            <SheetTitle className="break-all text-xl font-semibold tracking-tight">{node.label}</SheetTitle>
          </div>
        </div>
        <SheetDescription id="map-detail-description" className="sr-only">
          Detail perangkat {node.label}
        </SheetDescription>
      </SheetHeader>
      <div className="map-detail-body">
        <div className="map-detail-status">
          <p className="flex items-center gap-2 font-semibold">
            <span className={`map-dot ${node.status}`} />
            {STATUS[node.status]}
          </p>
          <p className="mt-2 leading-relaxed text-muted-foreground">{node.statusReason}</p>
        </div>
        {node.sources.length > 0 && (
          <div className="map-detail-sources">
            {node.sources.map((s) => (
              <span key={s}>{SOURCE[s]}</span>
            ))}
          </div>
        )}
        <section className="map-detail-section" aria-label="Informasi perangkat">
          <h3>Informasi perangkat</h3>
          <dl className="map-details">
            {
              [
                ["IP address", node.ips.join(", ") || null],
                ["MAC address", node.mac],
                ["Interface", node.interfaceName],
                ["VLAN ID", node.vlanId],
                ...Object.entries(node.details).map(([k, v]) => [DETAIL_LABELS[k] ?? k, v]),
              ]
                .filter(([, value]) => value !== null && value !== undefined && (typeof value === "boolean" || (String(value).trim() !== "" && Number(value) !== 0)))
                .map(([label, value], i) => (
                  <div key={i}>
                    <dt>{label}</dt>
                    <dd>{typeof value === "boolean" ? (value ? "Ya" : "Tidak") : String(value)}</dd>
                  </div>
                ))
            }
          </dl>
        </section>
        <div className="map-detail-section">
          <h3>Hubungan jaringan</h3>
          {relations.length === 0 ? (
            <p className="text-muted-foreground">Hubungan belum diketahui.</p>
          ) : (
            <div className="max-h-64 space-y-1 overflow-y-auto">
              {relations.map((edge) => {
                const other = byId.get(edge.source === node.id ? edge.target : edge.source);
                return (
                  <button type="button" className="map-relation" key={edge.id} onClick={() => onChoose(other!.id)}>
                    <span className="map-relation-icon">
                      <Network className="size-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block break-all font-medium">{other?.label}</span>
                      <span className="text-muted-foreground">
                        {edge.label} · {SOURCE[edge.evidence]}
                      </span>
                    </span>
                    <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
                  </button>
                );
              })}
            </div>
          )}
        </div>
        {node.kind === "client" && (
          <div className="rounded-xl border p-3">
            <h3 className="font-semibold">Jalur logis ke gateway</h3>
            {path.length ? (
              <ol className="mt-3 space-y-2">
                {path.map((edge) => (
                  <li key={edge.id} className="break-words">
                    <span>
                      {byId.get(edge.target)?.label} → {byId.get(edge.source)?.label}
                    </span>
                    <span className="block text-[10px] text-muted-foreground">
                      {SOURCE[edge.evidence]} · {edge.label}
                    </span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="mt-2 text-muted-foreground">Jalur klien ke router tidak dapat dipastikan.</p>
            )}
            <p className="mt-3 font-medium">Kandidat default gateway ({gateways.length})</p>
            <p className="mt-1 break-all text-muted-foreground">
              {gateways
                .slice(0, 8)
                .map((n) => `${n.details.gateway} (${n.details["routing-table"]})`)
                .join(", ") || "Tidak tersedia"}
              {gateways.length > 8 ? " …" : ""}
            </p>
            <p className="mt-3 leading-relaxed text-muted-foreground">
              Jalur attachment, bukan hasil traceroute. Gateway yang dipilih klien, firewall, NAT dan kebijakan routing belum diverifikasi.
            </p>
          </div>
        )}
      </div>
    </>
  );
}
