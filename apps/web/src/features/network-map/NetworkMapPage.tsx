import { memo, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Background, Handle, Position, ReactFlow, ReactFlowProvider, useReactFlow, type NodeProps } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { NETWORK_NODE_KINDS, type NetworkMapSnapshot, type NetworkNode } from "@shared/network-map";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Network, Search, RefreshCw, X } from "@/components/icons";
import { apiFetch } from "@/lib/api";
import { navigate } from "@/lib/router";
import { useConnectors } from "../connectors/connector-hooks";
import { layoutMap, selectMapNodes, type MapFlowNode } from "./network-graph";
import { RouterSelector } from "../connectors/RouterSelector";
import { MapExportMenu } from "./MapExportMenu";
import { KIND, STATUS } from "./NetworkMapMeta";
import { ConnectorLink, MapState } from "./NetworkMapState";
import { DeviceDetails } from "./NetworkMapDetails";
import "./network-map.css";

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
