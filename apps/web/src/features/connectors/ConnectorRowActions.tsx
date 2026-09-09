import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Power, Trash2, RefreshCw } from "@/components/icons";
import type { ConnectorDTO } from "@shared/index";
import { useSetConnectorMode, useDisconnectConnector, useConnectConnector, useDeleteConnector } from "./connector-hooks";

export function ConnectorRowActions({ connector }: { connector: ConnectorDTO }) {
  const setMode = useSetConnectorMode(connector.id);
  const disconnect = useDisconnectConnector(connector.id);
  const connect = useConnectConnector(connector.id);
  const remove = useDeleteConnector(connector.id);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const connected = connector.status === "connected";
  const writeEnabled = connector.mode === "write";

  async function onToggle(next: boolean) {
    if (!connected) return;
    try {
      await setMode.mutateAsync({
        mode: next ? "write" : "read-only",
        expectedVersion: connector.modeVersion,
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal mengubah mode.");
    }
  }

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-3 border-t border-border/50 pt-3 sm:border-0 sm:pt-0">
      {/* Write Mode Switch */}
      <label
        className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs transition-colors cursor-pointer ${
          writeEnabled
            ? "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400"
            : "border-border/60 bg-muted/40 text-muted-foreground"
        }`}
        title={
          connected
            ? "Aktifkan Write Mode untuk mengizinkan perubahan konfigurasi router"
            : "Hubungkan router terlebih dahulu untuk mengaktifkan mode Write"
        }
      >
        <span className="font-medium">Write</span>
        <Switch checked={writeEnabled} disabled={!connected || setMode.isPending} onCheckedChange={onToggle} aria-label="Mode Write" />
      </label>

      {/* Connect / Disconnect */}
      {connected ? (
        <Button variant="outline" size="sm" onClick={() => disconnect.mutate()} disabled={disconnect.isPending} className="h-8 gap-1.5 text-xs">
          <Power className="size-3.5 text-muted-foreground" />
          Putuskan
        </Button>
      ) : (
        <Button
          variant="outline"
          size="sm"
          onClick={() => connect.mutate()}
          disabled={connect.isPending}
          className="h-8 gap-1.5 text-xs bg-indigo-600 hover:bg-indigo-500 text-white border-transparent"
        >
          {connect.isPending ? <RefreshCw className="size-3.5 animate-spin" /> : <Power className="size-3.5" />}
          Hubungkan
        </Button>
      )}

      {/* Delete button */}
      {confirmDelete ? (
        <div className="flex items-center gap-1 animate-in fade-in duration-150">
          <Button
            variant="destructive"
            size="sm"
            onClick={() => remove.mutate()}
            disabled={remove.isPending}
            className="h-8 px-2.5 text-xs font-semibold"
          >
            Hapus?
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)} className="h-8 px-2 text-xs">
            Batal
          </Button>
        </div>
      ) : (
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setConfirmDelete(true)}
          className="size-8 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          title="Hapus connector router ini"
        >
          <Trash2 className="size-4" />
        </Button>
      )}
    </div>
  );
}
