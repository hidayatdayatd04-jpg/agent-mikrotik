import { useRef, useState } from "react";
import { toast } from "sonner";
import type { NetworkMapSnapshot } from "@shared/network-map";
import { Button } from "@/components/ui/button";
import { ChevronDown, Download, Loader2 } from "@/components/icons";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ExportFormatIcon } from "./ExportFormatIcon";
import type { layoutMap } from "./network-graph";
import type { MapExportFormat } from "./network-map-export";

export function MapExportMenu({ graph, snapshot, scope, disabled }: { graph: ReturnType<typeof layoutMap>; snapshot: NetworkMapSnapshot; scope: string; disabled: boolean }) {
  const [exporting, setExporting] = useState(false);
  const lock = useRef(false);
  const run = async (format: MapExportFormat) => {
    if (lock.current) return;
    lock.current = true; setExporting(true);
    try {
      const { exportNetworkMap } = await import("./network-map-export");
      await exportNetworkMap(format, graph, snapshot, scope);
      toast.success(`Peta berhasil diekspor ke ${format.toUpperCase()}`);
    } catch (error) { toast.error(error instanceof Error ? error.message : "Gagal mengekspor peta."); }
    finally { lock.current = false; setExporting(false); }
  };
  return <DropdownMenu>
    <DropdownMenuTrigger asChild><Button size="sm" variant="outline" className="map-toolbar-button" disabled={disabled || exporting || !graph.nodes.length}>
      {exporting ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}{exporting ? "Mengekspor…" : "Export"}
      <ChevronDown className="size-3 text-muted-foreground" />
    </Button></DropdownMenuTrigger>
    <DropdownMenuContent align="end" sideOffset={8} className="map-export-menu w-64 rounded-xl p-1.5">
      {([['png', 'Gambar PNG', 'Gambar resolusi tinggi'], ['pdf', 'Dokumen PDF', 'Siap disimpan dan dicetak'], ['svg', 'Vektor SVG', 'Tetap tajam saat diperbesar']] as const).map(([format, label, description]) =>
        <DropdownMenuItem key={format} className="map-export-option cursor-pointer gap-3 rounded-lg px-3 py-3" onSelect={() => void run(format)}>
          <ExportFormatIcon format={format} /><span className="min-w-0 flex-1"><span className="block text-xs font-semibold">{label}</span><span className="mt-1 block text-[10px] text-muted-foreground">{description}</span></span>
          <span className="map-format-extension">.{format}</span>
        </DropdownMenuItem>)}
    </DropdownMenuContent>
  </DropdownMenu>;
}
