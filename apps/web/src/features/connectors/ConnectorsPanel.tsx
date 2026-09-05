import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import type { ConnectorDTO } from "@shared/index";
import { useConnectors, useSetConnectorMode, useDisconnectConnector, useConnectConnector, useDeleteConnector } from "./connector-hooks";
import { ConnectorDialog } from "./ConnectorDialog";

const STATUS_LABEL: Record<string, string> = {
  unverified: "Belum diverifikasi",
  connecting: "Menghubungkan",
  connected: "Terhubung",
  disconnected: "Terputus",
  failed: "Gagal",
};

function StatusBadge({ status }: { status: string }) {
  const color =
    status === "connected"
      ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
      : status === "failed"
        ? "bg-destructive/15 text-destructive"
        : "bg-muted text-muted-foreground";
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${color}`}>{STATUS_LABEL[status] ?? status}</span>;
}

function ConnectorRow({ connector }: { connector: ConnectorDTO }) {
  const setMode = useSetConnectorMode(connector.id);
  const disconnect = useDisconnectConnector(connector.id);
  const connect = useConnectConnector(connector.id);
  const remove = useDeleteConnector(connector.id);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const connected = connector.status === "connected";
  const writeEnabled = connector.mode === "write";

  async function onToggle(next: boolean) {
    if (!connected) return; // switch disabled otherwise
    try {
      await setMode.mutateAsync({
        mode: next ? "write" : "read-only",
        expectedVersion: connector.modeVersion,
      });
    } catch {
      // POLICY_CHANGED etc. — list refetch shows the authoritative state
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{connector.label}</span>
          <StatusBadge status={connector.status} />
        </div>
        <div className="text-muted-foreground truncate text-sm">
          {connector.host}:{connector.port} · {connector.username}
          {connector.routerIdentity && <span> · {connector.routerIdentity}</span>}
        </div>
        {connector.lastVerifiedAt && (
          <div className="text-muted-foreground text-xs">
            Terakhir diverifikasi: {new Date(connector.lastVerifiedAt).toLocaleString("id-ID")}
          </div>
        )}
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm" title={connected ? "Mode Write" : "Hubungkan dulu untuk mengubah mode"}>
          <span className={writeEnabled ? "font-medium" : "text-muted-foreground"}>Write</span>
          <Switch
            checked={writeEnabled}
            disabled={!connected || setMode.isPending}
            onCheckedChange={onToggle}
            aria-label="Mode write"
          />
        </label>
        {connected ? (
          <Button variant="outline" size="sm" onClick={() => disconnect.mutate()} disabled={disconnect.isPending}>
            Putuskan
          </Button>
        ) : (
          <Button variant="outline" size="sm" onClick={() => connect.mutate()} disabled={connect.isPending}>
            Hubungkan
          </Button>
        )}
        {confirmDelete ? (
          <span className="flex items-center gap-1">
            <Button variant="destructive" size="sm" onClick={() => remove.mutate()} disabled={remove.isPending}>
              Yakin?
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>
              Batal
            </Button>
          </span>
        ) : (
          <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(true)}>
            Hapus
          </Button>
        )}
      </div>
    </div>
  );
}

export function ConnectorsPanel() {
  const { data: connectors, isLoading, error } = useConnectors();
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Connector Router</CardTitle>
        <Button size="sm" onClick={() => setDialogOpen(true)}>
          Tambah Router
        </Button>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {isLoading && <p className="text-muted-foreground text-sm">Memuat…</p>}
        {error && <p className="text-destructive text-sm">Gagal memuat daftar router.</p>}
        {!isLoading && !error && (connectors ?? []).length === 0 && (
          <p className="text-muted-foreground text-sm">
            Belum ada router. Tambahkan router untuk mulai mengelola lewat agen AI.
          </p>
        )}
        {(connectors ?? []).map((c) => (
          <ConnectorRow key={c.id} connector={c} />
        ))}
        <Separator className="my-1" />
        <p className="text-muted-foreground text-xs">
          Router baru selalu mulai Read-Only. Mode Write hanya aktif untuk koneksi yang sedang terhubung dan otomatis
          dicabut saat diputus.
        </p>
      </CardContent>
      <ConnectorDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </Card>
  );
}
