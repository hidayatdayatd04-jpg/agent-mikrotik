import { useState } from "react";
import { Plug, Plus } from "@/components/icons";
import { DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import type { ConnectorDTO } from "@shared/index";
import { useConnectAnyConnector } from "@/features/connectors/connector-hooks";
import { toast } from "sonner";
import { ConnectorPickerItem } from "./ConnectorPickerItem";

export function ConnectorPicker(props: {
  connectors: ConnectorDTO[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onAddRouter: () => void;
  disabled?: boolean;
}) {
  const [connectingId, setConnectingId] = useState<string | null>(null);
  const connectMutation = useConnectAnyConnector();

  const handleConnect = (c: ConnectorDTO) => {
    if (props.disabled) return;
    setConnectingId(c.id);
    connectMutation.mutate(c.id, {
      onSuccess: () => {
        setConnectingId(null);
        props.onSelect(c.id);
        toast.success(`Berhasil terhubung ke ${c.label} (${c.host})!`);
      },
      onError: (err) => {
        setConnectingId(null);
        toast.error(`Gagal terhubung ke ${c.label}: ${err.message}`);
      },
    });
  };

  const handleItemClick = (c: ConnectorDTO) => {
    if (props.disabled) return;
    if (c.status === "connected") {
      props.onSelect(c.id);
      toast.success(`Connector ${c.label} dipilih.`);
    } else {
      handleConnect(c);
    }
  };

  const hasAny = props.connectors.length > 0;

  return (
    <div className="flex flex-col gap-1 pb-1">
      <div className="flex items-center justify-between px-2 pt-1 pb-1 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
        <span className="flex items-center gap-1.5">
          <Plug className="size-3.5 text-indigo-500" />
          <span>Connector Router</span>
        </span>
        <span className="text-[10px] font-normal text-muted-foreground lowercase">
          {hasAny ? `${props.connectors.length} router` : "belum ada"}
        </span>
      </div>

      {hasAny ? (
        <div className="flex flex-col gap-0.5 max-h-48 overflow-y-auto">
          {props.connectors.map((c) => (
            <ConnectorPickerItem
              key={c.id}
              connector={c}
              isSelected={c.id === props.selectedId}
              isConnecting={connectingId === c.id}
              disabled={props.disabled}
              onItemClick={handleItemClick}
              onConnect={handleConnect}
            />
          ))}
        </div>
      ) : (
        <div className="px-2.5 py-2 text-xs text-muted-foreground">
          Belum ada router tersimpan.
        </div>
      )}

      <DropdownMenuItem
        onSelect={props.onAddRouter}
        className="gap-2.5 px-2.5 py-1.5 text-xs font-medium rounded-xl cursor-pointer text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300"
      >
        <Plus className="size-3.5" />
        <span>Tambah router baru</span>
      </DropdownMenuItem>

      <DropdownMenuSeparator className="my-1" />
    </div>
  );
}

export { ConnectorPicker as ConnectorSubmenu };
