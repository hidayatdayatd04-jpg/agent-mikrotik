import { useState } from "react";
import { Check, Loader2, Plug, Plus } from "@/components/icons";
import { DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import type { ConnectorDTO } from "@shared/index";
import { useConnectAnyConnector } from "@/features/connectors/connector-hooks";
import { toast } from "sonner";
import { cn } from "cn";

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
          {props.connectors.map((c) => {
            const isSelected = c.id === props.selectedId;
            const isConnected = c.status === "connected";
            const isConnecting = connectingId === c.id;

            return (
              <div
                key={c.id}
                onClick={() => handleItemClick(c)}
                className={cn(
                  "group flex items-center justify-between gap-2 rounded-xl px-2.5 py-2 text-xs transition-colors cursor-pointer select-none",
                  isSelected
                    ? "bg-indigo-50/90 dark:bg-indigo-950/50 text-foreground border border-indigo-200/50 dark:border-indigo-800/50 shadow-2xs"
                    : "hover:bg-accent/70 hover:text-foreground text-muted-foreground hover:text-foreground"
                )}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    handleItemClick(c);
                  }
                }}
              >
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <span
                    className={cn(
                      "size-2 shrink-0 rounded-full",
                      isConnected
                        ? "bg-emerald-500 shadow-xs shadow-emerald-500/50"
                        : "bg-muted-foreground/30"
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className={cn("truncate font-medium", isSelected && "text-indigo-600 dark:text-indigo-400 font-semibold")}>
                        {c.label}
                      </span>
                      {isConnected && c.mode === "read-only" && (
                        <span className="shrink-0 rounded px-1 py-0.2 text-[9px] font-semibold bg-sky-500/10 text-sky-600 dark:text-sky-400">
                          RO
                        </span>
                      )}
                      {isConnected && c.mode === "write" && (
                        <span className="shrink-0 rounded px-1 py-0.2 text-[9px] font-semibold bg-amber-500/10 text-amber-600 dark:text-amber-400">
                          Write
                        </span>
                      )}
                    </div>
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {c.host} {isConnected ? `· ${c.routerIdentity || "Terhubung"}` : `· Terputus`}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  {!isConnected ? (
                    <button
                      type="button"
                      disabled={isConnecting || props.disabled}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleConnect(c);
                      }}
                      className="flex items-center gap-1 rounded-lg bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 px-2 py-1 text-[11px] font-medium transition-colors cursor-pointer disabled:opacity-50"
                    >
                      {isConnecting ? (
                        <>
                          <Loader2 className="size-3 animate-spin" />
                          <span>Koneksi…</span>
                        </>
                      ) : (
                        <span>Hubungkan</span>
                      )}
                    </button>
                  ) : isSelected ? (
                    <Check className="size-4 text-indigo-600 dark:text-indigo-400 shrink-0" />
                  ) : null}
                </div>
              </div>
            );
          })}
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
