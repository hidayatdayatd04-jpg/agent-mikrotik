import { memo, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Background, Handle, Position, ReactFlow, ReactFlowProvider, useReactFlow, type NodeProps } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { NETWORK_NODE_KINDS, networkAttachmentPath, type NetworkMapSnapshot, type NetworkNode } from "@shared/network-map";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Network, Globe, Server, Layers, Plug, User, Search, RefreshCw, Loader2, X, ChevronRight } from "@/components/icons";
import { apiFetch } from "@/lib/api";
import { navigate } from "@/lib/router";
import { useConnectors } from "../connectors/connector-hooks";
import { layoutMap, selectMapNodes, type MapFlowNode } from "./network-graph";
import { RouterSelector } from "../connectors/RouterSelector";
import { MapExportMenu } from "./MapExportMenu";
import "./network-map.css";

const KIND = {
  gateway: { label: "Gateway", icon: Globe }, router: { label: "Router", icon: Server },
  interface: { label: "Interface", icon: Plug }, bridge: { label: "Bridge", icon: Network },
  vlan: { label: "VLAN", icon: Layers }, subnet: { label: "Subnet", icon: Globe }, client: { label: "Klien", icon: User },
};
const SOURCE = { configuration: "Konfigurasi", dhcp: "DHCP", arp: "ARP", neighbor: "Neighbor", inferred: "Inferensi" };
const STATUS = { online: "Online", offline: "Offline", unknown: "Tidak diketahui" };

function ConnectorLink() {
  return <Button variant="outline" size="sm" onClick={() => navigate({ name: "settings", section: "connectors" })}><Plug className="size-4" />Buka Connector</Button>;
}

export default function NetworkMapPage({ connectionId }: { connectionId?: string }) {
  const connectors = useConnectors();
  const items = connectors.data ?? [];
  const selectedId = connectionId ?? (items.find(c => c.status === "connected")?.id ?? (items.length ? items[0]!.id : ""));
  const connector = items.find(c => c.id === selectedId);
  return <section className="network-map flex min-h-0 min-w-0 flex-1 flex-col" aria-label="Network Map">
    <header className="map-header">
      <div className="flex min-w-0 items-center gap-3">
        <span className="map-title-icon"><Network className="size-5" /></span>
        <div><h1 className="text-lg font-semibold tracking-tight">Network Map</h1><p className="text-xs text-muted-foreground">Jelajahi perangkat dan koneksi jaringan</p></div>
      </div>
      <RouterSelector connectors={items} selectedId={selectedId} loading={connectors.isLoading}
        disabled={connectors.isError} onSelect={id => navigate({ name: "network-map", id })} />
    </header>
    {connectors.isLoading ? <MapState title="Memuat koneksi…" loading />
      : connectors.isError ? <MapState title="Gagal memuat connector" description={connectors.error.message}><Button variant="outline" onClick={() => void connectors.refetch()}>Coba lagi</Button></MapState>
      : !connector ? <MapState title={selectedId ? "Connector tidak ditemukan" : items.length ? "Pilih jaringan yang ingin dijelajahi" : "Belum ada router terdaftar"}
        description="Pilih router di atas untuk membuka peta jaringan. Daftarkan router melalui halaman Connector jika belum tersedia."><ConnectorLink /></MapState>
      : connector.status !== "connected" ? <MapState title="Router disconnected" description={`${connector.label} belum terkoneksi. Buka pemilih router di atas dan pilih Hubungkan.`}><ConnectorLink /><Button variant="ghost" onClick={() => void connectors.refetch()}>Periksa status</Button></MapState>
      : <ConnectedMap key={`${connector.id}:${connector.updatedAt}:${connector.lastVerifiedAt}`} connectionId={connector.id} />}
  </section>;
}

function MapState({ title, description, loading, children }: { title: string; description?: string; loading?: boolean; children?: React.ReactNode }) {
  return <div className="map-state" role="status" aria-live="polite">
    <div className="map-state-symbol">{loading ? <Loader2 className="size-7 animate-spin" /> : <Network className="size-7" />}</div>
    <h2 className="text-base font-semibold">{title}</h2>
    {description && <p className="max-w-md text-center text-sm leading-relaxed text-muted-foreground">{description}</p>}
    <div className="flex flex-wrap justify-center gap-2">{children}</div>
  </div>;
}

function ConnectedMap({ connectionId }: { connectionId: string }) {
  const force = useRef(false);
  const query = useQuery({ queryKey: ["network-map", connectionId], staleTime: 60_000, retry: false,
    refetchOnWindowFocus: false, refetchOnReconnect: false,
    queryFn: ({ signal }) => apiFetch<NetworkMapSnapshot>(`/api/network-map/${encodeURIComponent(connectionId)}${force.current ? "?refresh=1" : ""}`, { signal }),
  });
  const refresh = async () => { force.current = true; try { await query.refetch(); } finally { force.current = false; } };
  const data = query.data;
  const refreshButton = <Button size="sm" variant="outline" className="map-toolbar-button" disabled={query.isFetching} onClick={() => void refresh()}><RefreshCw className={`size-3.5 ${query.isFetching ? "animate-spin" : ""}`} />{query.isFetching ? "Membaca…" : "Refresh"}</Button>;
  return <>
    {query.isPending ? <MapState title="Membaca topologi router…" description="Mengambil interface, bridge, VLAN, route dan tabel perangkat. Pembacaan dibatasi 25 detik." loading />
      : query.isError ? <MapState title="Topologi belum dapat dibaca" description={query.error.message}><ConnectorLink /><Button variant="outline" disabled={query.isFetching} onClick={() => void refresh()}>Coba lagi</Button></MapState>
      : data?.state === "disconnected" ? <MapState title="Router disconnected" description={data.message ?? undefined}><ConnectorLink /></MapState>
      : !data || data.state === "error" || !data.nodes.length ? <MapState title={data?.state === "error" ? "Data topologi tidak tersedia" : "Belum ada data topologi"} description={data?.message ?? "Router belum mengembalikan informasi jaringan."}><ConnectorLink /></MapState>
      : <ReactFlowProvider><MapExplorer snapshot={data} busy={query.isFetching} refreshButton={refreshButton} /></ReactFlowProvider>}
  </>;
}

const DeviceNode = memo(function DeviceNode({ data, selected }: NodeProps<MapFlowNode>) {
  const node = data.device, Icon = KIND[node.kind].icon;
  return <div className={`map-node map-kind-${node.kind} ${selected ? "is-selected" : ""}`}>
    <Handle type="target" position={Position.Left} isConnectable={false} />
    <span className="map-node-icon"><Icon className="size-4" /></span>
    <div className="min-w-0 flex-1">
      <div className="flex items-center justify-between gap-2"><span className="map-node-kind">{KIND[node.kind].label}{node.vlanId ? ` ${node.vlanId}` : ""}</span><span className={`map-dot ${node.status}`} title={STATUS[node.status]} /></div>
      <p className="truncate text-xs font-semibold" title={node.label}>{node.label}</p>
      <p className="truncate font-mono text-[10px] text-muted-foreground">{node.ips[0] || node.mac || (node.kind === "vlan" ? `Parent: ${node.details.parent ?? "?"}` : STATUS[node.status])}</p>
    </div>
    <Handle type="source" position={Position.Right} isConnectable={false} />
  </div>;
});
const NODE_TYPES = { device: DeviceNode };

function MapExplorer({ snapshot, busy, refreshButton }: { snapshot: NetworkMapSnapshot; busy: boolean; refreshButton: React.ReactNode }) {
  const [search, setSearch] = useState("");
  const query = useDeferredValue(search);
  const [page, setPage] = useState(0);
  const [selection, setSelection] = useState<string | null>(null);
  const flow = useReactFlow<MapFlowNode>();
  const visible = useMemo(() => selectMapNodes(snapshot, query, NETWORK_NODE_KINDS, page), [snapshot, query, page]);
  const graph = useMemo(() => layoutMap(visible.nodes, visible.edges), [visible.nodes, visible.edges]);
  const selected = snapshot.nodes.find(n => n.id === selection) ?? null;
  useEffect(() => { const timer = window.setTimeout(() => void flow.fitView({ padding: 0.18, maxZoom: 1, duration: 0 }), 50); return () => clearTimeout(timer); }, [graph, flow]);
  const choose = (node: NetworkNode) => { setSelection(node.id); };
  const reset = () => { setSearch(""); setPage(0); void flow.fitView({ padding: 0.18, maxZoom: 1 }); };
  return <div className="flex min-h-0 min-w-0 flex-1 flex-col">
    <div className="map-toolbar">
      <div className="map-search"><Search className="map-search-icon size-4" />
        <Input value={search} onChange={e => { setSearch(e.target.value); setPage(0); }} placeholder="Cari hostname, IP, MAC, atau VLAN..." aria-label="Cari perangkat" className="map-search-input" />
        {search && <button type="button" className="map-search-clear" aria-label="Hapus pencarian" onClick={() => { setSearch(""); setPage(0); }}><X className="size-3.5" /></button>}
      </div>
      <div className="map-toolbar-actions">
        {snapshot.state === "partial" && <span className="text-[11px] text-amber-700 dark:text-amber-400" role="status">Data parsial</span>}
        <MapExportMenu graph={graph} snapshot={snapshot} disabled={busy || search !== query} scope={`${query ? "Hasil pencarian" : "Peta jaringan"} - halaman ${visible.page + 1}/${visible.pageCount}`} />
        {refreshButton}
      </div>
    </div>
    <div className="map-canvas relative flex min-h-[280px] min-w-0 flex-1 overflow-hidden" aria-busy={busy}>
      <div className="relative min-w-0 flex-1" data-testid="network-graph">
        <ReactFlow<MapFlowNode> proOptions={{ hideAttribution: true }} nodes={graph.nodes} edges={graph.edges} nodeTypes={NODE_TYPES} nodesDraggable={false} nodesConnectable={false}
          edgesReconnectable={false} deleteKeyCode={null} onlyRenderVisibleElements minZoom={0.03} maxZoom={2} fitView
          onNodeClick={(_event, node) => choose(node.data.device)} onKeyDown={event => {
            if (event.key !== "Enter" && event.key !== " ") return;
            const id = (event.target as HTMLElement).closest(".react-flow__node")?.getAttribute("data-id");
            const node = snapshot.nodes.find(n => n.id === id);
            if (node) { event.preventDefault(); choose(node); }
          }}
          aria-label="Topologi jaringan interaktif" fitViewOptions={{ padding: 0.18, maxZoom: 1 }}>
          <Background gap={20} size={1} color="var(--border)" />
        </ReactFlow>
        {!visible.nodes.length && <div className="pointer-events-none absolute inset-0 flex items-center justify-center"><p className="rounded-xl border bg-card p-5 text-sm">Tidak ada perangkat sesuai pencarian.</p></div>}
        <div className="map-controls" aria-label="Kontrol tampilan graph">
          <button onClick={() => void flow.zoomIn()} aria-label="Perbesar" title="Perbesar">+</button>
          <button onClick={() => void flow.zoomOut()} aria-label="Perkecil" title="Perkecil">−</button>
          <button onClick={() => void flow.fitView({ padding: 0.18, maxZoom: 1 })} aria-label="Fit to screen">Fit</button>
          <button onClick={reset} aria-label="Reset view">Reset</button>
        </div>
      </div>
    </div>
    {visible.pageCount > 1 && <div className="map-pagination"><Button size="sm" variant="ghost" disabled={visible.page === 0} onClick={() => setPage(visible.page - 1)}>Sebelumnya</Button><span>{visible.page + 1} / {visible.pageCount}</span><Button size="sm" variant="ghost" disabled={visible.page + 1 >= visible.pageCount} onClick={() => setPage(visible.page + 1)}>Berikutnya</Button></div>}
    <Sheet open={!!selected} onOpenChange={open => { if (!open) setSelection(null); }}>
      <SheetContent className={`map-detail-sheet ${selected ? `map-kind-${selected.kind}` : ""}`} aria-describedby="map-detail-description">
        {selected && <DeviceDetails node={selected} snapshot={snapshot} onChoose={setSelection} />}
      </SheetContent>
    </Sheet>
  </div>;
}

const DETAIL_LABELS: Record<string, string> = { identity: "Identitas", version: "Versi RouterOS / perangkat", uptime: "Uptime", parent: "Parent interface",
  type: "Tipe", mtu: "MTU", "vlan-filtering": "VLAN filtering", "free-memory": "Memori bebas", "total-memory": "Total memori",
  "board-name": "Board", "management-ip": "IP manajemen", "dhcp-status": "Status DHCP lease", "dhcp-server": "DHCP server", "expires-after": "Lease kedaluwarsa dalam",
  "last-seen": "Terakhir terlihat (DHCP)", "detected-client-records": "Record klien terdeteksi", "clients-arp-neighbor": "Klien dengan ARP / neighbor",
  "clients-dhcp-only (inferred)": "Klien DHCP saja (inferensi)", "router-addresses": "Alamat router / kandidat gateway lokal", "router-address": "Alamat router",
  "route-active": "Default route aktif", "route-disabled": "Route disabled", "routing-table": "Tabel routing", "attachment-note": "Catatan hubungan" };

function DeviceDetails({ node, snapshot, onChoose }: { node: NetworkNode; snapshot: NetworkMapSnapshot; onChoose: (id: string) => void }) {
  const Icon = KIND[node.kind].icon;
  const relations = snapshot.edges.filter(e => e.source === node.id || e.target === node.id);
  const byId = new Map(snapshot.nodes.map(n => [n.id, n]));
  const path = networkAttachmentPath(snapshot, node.id);
  const gateways = snapshot.nodes.filter(n => n.kind === "gateway" && n.details["route-active"] === true && n.details["route-disabled"] !== true);
  return <>
    <SheetHeader className="map-detail-header">
      <div className="map-detail-identity">
        <span className="map-detail-icon"><Icon className="size-6" /></span>
        <div className="min-w-0">
          <p className="map-detail-kind">{KIND[node.kind].label}{node.vlanId ? ` \u00b7 VLAN ${node.vlanId}` : ""}</p>
          <SheetTitle className="break-all text-xl font-semibold tracking-tight">{node.label}</SheetTitle>
        </div>
      </div>
      <SheetDescription id="map-detail-description" className="sr-only">Detail perangkat {node.label}</SheetDescription>
    </SheetHeader>
    <div className="map-detail-body">
      <div className="map-detail-status"><p className="flex items-center gap-2 font-semibold"><span className={`map-dot ${node.status}`} />{STATUS[node.status]}</p><p className="mt-2 leading-relaxed text-muted-foreground">{node.statusReason}</p></div>
      {node.sources.length > 0 && <div className="map-detail-sources">{node.sources.map(s => <span key={s}>{SOURCE[s]}</span>)}</div>}
      <section className="map-detail-section" aria-label="Informasi perangkat"><h3>Informasi perangkat</h3>
        <dl className="map-details">
          {[['IP address', node.ips.join(", ") || null], ['MAC address', node.mac], ['Interface', node.interfaceName], ['VLAN ID', node.vlanId], ...Object.entries(node.details).map(([k, v]) => [DETAIL_LABELS[k] ?? k, v])]
            .filter(([, value]) => value !== null && value !== undefined && (typeof value === "boolean" || (String(value).trim() !== "" && Number(value) !== 0)))
            .map(([label, value], i) => <div key={i}><dt>{label}</dt><dd>{typeof value === "boolean" ? value ? "Ya" : "Tidak" : String(value)}</dd></div>)}
        </dl>
      </section>
      <div className="map-detail-section"><h3>Hubungan jaringan</h3>{relations.length === 0 ? <p className="text-muted-foreground">Hubungan belum diketahui.</p> : <div className="max-h-64 space-y-1 overflow-y-auto">{relations.map(edge => {
        const other = byId.get(edge.source === node.id ? edge.target : edge.source);
        return <button type="button" className="map-relation" key={edge.id} onClick={() => onChoose(other!.id)}><span className="map-relation-icon"><Network className="size-4" /></span><span className="min-w-0 flex-1"><span className="block break-all font-medium">{other?.label}</span><span className="text-muted-foreground">{edge.label} · {SOURCE[edge.evidence]}</span></span><ChevronRight className="size-3.5 shrink-0 text-muted-foreground" /></button>;
      })}</div>}</div>
      {node.kind === "client" && <div className="rounded-xl border p-3"><h3 className="font-semibold">Jalur logis ke gateway</h3>
        {path.length ? <ol className="mt-3 space-y-2">{path.map(edge => <li key={edge.id} className="break-words"><span>{byId.get(edge.target)?.label} → {byId.get(edge.source)?.label}</span><span className="block text-[10px] text-muted-foreground">{SOURCE[edge.evidence]} · {edge.label}</span></li>)}</ol> : <p className="mt-2 text-muted-foreground">Jalur klien ke router tidak dapat dipastikan.</p>}
        <p className="mt-3 font-medium">Kandidat default gateway ({gateways.length})</p><p className="mt-1 break-all text-muted-foreground">{gateways.slice(0, 8).map(n => `${n.details.gateway} (${n.details["routing-table"]})`).join(", ") || "Tidak tersedia"}{gateways.length > 8 ? " …" : ""}</p>
        <p className="mt-3 leading-relaxed text-muted-foreground">Jalur attachment, bukan hasil traceroute. Gateway yang dipilih klien, firewall, NAT dan kebijakan routing belum diverifikasi.</p>
      </div>}
    </div>
  </>;
}
