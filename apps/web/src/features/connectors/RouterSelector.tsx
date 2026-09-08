import { useRef, useState } from "react";
import type { ConnectorDTO } from "@shared/index";
import { Check, ChevronDown, Loader2, Plug, Server } from "@/components/icons";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel } from "@/components/ui/dropdown-menu";
import { DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useConnectAnyConnector } from "./connector-hooks";
import { toast } from "sonner";
import "./router-selector.css";

/** Only saved connectors belong here; discovery results must be registered first. */
export function RouterSelector({ connectors, selectedId, onSelect, loading = false, disabled = false }: {
  connectors: ConnectorDTO[];
  selectedId?: string;
  onSelect: (id: string) => void;
  loading?: boolean;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const lock = useRef(false);
  const connect = useConnectAnyConnector();
  const selected = connectors.find(router => router.id === selectedId);
  const choose = (router: ConnectorDTO) => {
    if (lock.current || disabled) return;
    if (router.status === "connected") { onSelect(router.id); setOpen(false); return; }
    lock.current = true;
    connect.mutate(router.id, {
      onSuccess: () => { onSelect(router.id); setOpen(false); toast.success(`Terhubung ke ${router.label}`); },
      onError: error => toast.error(`Gagal menghubungkan ${router.label}: ${error.message}`),
      onSettled: () => { lock.current = false; },
    });
  };
  return <DropdownMenu open={open} onOpenChange={setOpen}>
    <DropdownMenuTrigger asChild>
      <button type="button" className="router-selector" aria-label="Pilih router jaringan" disabled={loading || disabled}>
        <span className="router-selector-icon"><Server className="size-4" /></span>
        <span className="min-w-0 flex-1 text-left">
          <span className="block text-[10px] font-medium text-muted-foreground">Router jaringan</span>
          <span className="block truncate text-xs font-semibold">{loading ? "Memuat router…" : selected?.label ?? "Pilih router terdaftar"}</span>
          {selected && <span className="block truncate font-mono text-[10px] text-muted-foreground">{selected.host}</span>}
        </span>
        {connect.isPending ? <Loader2 className="size-4 animate-spin" /> : selected && <span className={`map-dot ${selected.status === "connected" ? "online" : "offline"}`} title={selected.status === "connected" ? "Terhubung" : "Terputus"} />}
        <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
      </button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" sideOffset={8} className="router-selector-menu rounded-xl p-1.5">
      <DropdownMenuLabel className="px-2 py-2 text-[10px] font-medium text-muted-foreground">Router terdaftar · {connectors.length}</DropdownMenuLabel>
      {!connectors.length && <p className="px-2 py-3 text-xs leading-relaxed text-muted-foreground">Belum ada router terdaftar. Tambahkan router melalui halaman Connector.</p>}
      {connectors.map(router => {
        const connected = router.status === "connected";
        const pending = connect.isPending && connect.variables === router.id;
        return <DropdownMenuItem key={router.id} disabled={connect.isPending} className="cursor-pointer gap-3 rounded-lg px-2.5 py-3"
          onSelect={event => { event.preventDefault(); choose(router); }}>
          <span className={`map-dot ${connected ? "online" : "offline"}`} />
          <span className="min-w-0 flex-1"><span className="block truncate text-xs font-semibold">{router.label}</span><span className="block truncate text-[10px] text-muted-foreground">{router.host} · {connected ? "Terhubung" : "Terputus"}</span></span>
          {pending ? <Loader2 className="size-4 animate-spin" /> : connected ? router.id === selectedId ? <Check className="size-4 text-cyan-600" /> : <span className="text-[10px] text-muted-foreground">Pilih</span> : <span className="flex items-center gap-1 rounded-md bg-cyan-500/10 px-2 py-1 text-[10px] font-medium text-cyan-700 dark:text-cyan-300"><Plug className="size-3" />Hubungkan</span>}
        </DropdownMenuItem>;
      })}
    </DropdownMenuContent>
  </DropdownMenu>;
}
