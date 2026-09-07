import { Check, Plug, Plus } from "lucide-react";
import { DropdownMenuItem, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger } from "@/components/ui/dropdown-menu";
import type { ConnectorDTO } from "@shared/index";

export function ConnectorSubmenu(props: {
  connectors: ConnectorDTO[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onAddRouter: () => void;
  disabled?: boolean;
}) {
  const hasAny = props.connectors.length > 0;
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger disabled={props.disabled} className="gap-3 px-2 py-2.5">
        <Plug className="size-4" />
        <span className="flex-1 text-xs">Connector</span>
        <span className="text-[11px] text-muted-foreground">{hasAny ? `${props.connectors.length}` : "Belum terhubung"}</span>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="w-72 p-1.5">
        <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Connector tersimpan</div>
        {props.connectors.map((c) => {
          const selected = c.id === props.selectedId;
          return (
            <DropdownMenuItem key={c.id} onSelect={() => props.onSelect(c.id)} className="flex items-center gap-2 px-2 py-2 text-xs">
              <span className={`size-2 shrink-0 rounded-full ${c.status === "connected" ? "bg-emerald-500" : "bg-muted-foreground/40"}`} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">
                  {c.label} ({c.host})
                </span>
                <span className="block text-[11px] text-muted-foreground">
                  {c.status === "connected" ? `terhubung${c.routerIdentity ? ` · ${c.routerIdentity}` : ""}` : c.status}
                </span>
              </span>
              {selected && <Check className="size-3.5 shrink-0 text-indigo-500" />}
            </DropdownMenuItem>
          );
        })}
        {!hasAny && <p className="px-2 py-2 text-xs text-muted-foreground">Belum ada connector. Tambahkan router untuk SSH.</p>}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={props.onAddRouter} className="gap-2 px-2 py-2 text-xs font-medium">
          <Plus className="size-4" /> Tambah router
        </DropdownMenuItem>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}
