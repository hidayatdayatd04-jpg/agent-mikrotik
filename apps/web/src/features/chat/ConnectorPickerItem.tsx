import { Check, Loader2 } from "@/components/icons";
import type { ConnectorDTO } from "@shared/index";
import { cn } from "cn";

export function ConnectorPickerItem(props: {
  connector: ConnectorDTO;
  isSelected: boolean;
  isConnecting: boolean;
  disabled?: boolean;
  onItemClick: (c: ConnectorDTO) => void;
  onConnect: (c: ConnectorDTO) => void;
}) {
  const c = props.connector;
  const isSelected = props.isSelected;
  const isConnected = c.status === "connected";
  const isConnecting = props.isConnecting;

  return (
    <div
      onClick={() => props.onItemClick(c)}
      className={cn(
        "group flex items-center justify-between gap-2 rounded-xl px-2.5 py-2 text-xs transition-colors cursor-pointer select-none",
        isSelected
          ? "bg-indigo-50/90 dark:bg-indigo-950/50 text-foreground border border-indigo-200/50 dark:border-indigo-800/50 shadow-2xs"
          : "hover:bg-accent/70 hover:text-foreground text-muted-foreground hover:text-foreground",
      )}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          props.onItemClick(c);
        }
      }}
    >
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <span
          className={cn(
            "size-2 shrink-0 rounded-full",
            isConnected ? "bg-emerald-500 shadow-xs shadow-emerald-500/50" : "bg-muted-foreground/30",
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
              props.onConnect(c);
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
}
