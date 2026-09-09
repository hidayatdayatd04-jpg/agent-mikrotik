import { Button } from "@/components/ui/button";
import { Radio, RefreshCw, Loader2 } from "@/components/icons";
import { useDiscoverConnectors, type DiscoveredRouterDTO } from "./connector-hooks";
import { DiscoveredRouterCard } from "./DiscoveredRouterCard";

export function DiscoverySection(props: { discovery: ReturnType<typeof useDiscoverConnectors>; onConnect: (dev: DiscoveredRouterDTO) => void }) {
  const { discovery } = props;
  return (
    <div className="rounded-2xl border border-indigo-500/30 bg-gradient-to-b from-indigo-500/5 to-transparent p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 pb-3">
        <div className="flex items-center gap-2.5">
          <div className="flex size-8 items-center justify-center rounded-xl bg-indigo-500/10 text-indigo-500 border border-indigo-500/20">
            <Radio className="size-4 animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-foreground">Router Terdeteksi Otomatis</h2>
              <span className="rounded-md border border-indigo-500/30 bg-indigo-500/10 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-indigo-500">
                MNDP · Port 5678
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Mendeteksi RouterOS di VirtualBox & jaringan lokal otomatis (seperti Neighbors di WinBox).
            </p>
          </div>
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={() => discovery.refetch()}
          disabled={discovery.isFetching}
          className="h-8 gap-1.5 text-xs rounded-xl border-border/70 bg-card/60 hover:bg-card"
        >
          <RefreshCw className={`size-3.5 ${discovery.isFetching ? "animate-spin text-indigo-500" : ""}`} />
          <span>{discovery.isFetching ? "Memindai Jaringan…" : "Pindai Ulang"}</span>
        </Button>
      </div>

      {discovery.isFetching && (
        <div className="flex items-center justify-center py-8 text-xs text-muted-foreground gap-2">
          <Loader2 className="size-4 animate-spin text-indigo-500" />
          <span>Mengirim broadcast MNDP dan mendengarkan respon router…</span>
        </div>
      )}

      {!discovery.isFetching && (discovery.data ?? []).length === 0 && (
        <div className="rounded-xl border border-border/60 bg-card/40 p-4 text-center space-y-1.5">
          <p className="text-xs font-medium text-foreground">Tidak ada router MikroTik terdeteksi</p>
          <p className="text-[11px] text-muted-foreground max-w-md mx-auto leading-relaxed">
            Pastikan MikroTik RouterOS di VirtualBox/LAN sedang menyala dan MNDP aktif (IP &gt; Neighbors). Anda juga dapat menambahkan router
            secara manual di bawah.
          </p>
        </div>
      )}

      {!discovery.isFetching && (discovery.data ?? []).length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2">
          {discovery.data!.map((dev) => (
            <DiscoveredRouterCard key={`${dev.mac}-${dev.ipv4 || dev.ip}`} device={dev} onConnect={() => props.onConnect(dev)} />
          ))}
        </div>
      )}
    </div>
  );
}
