import { toast } from "sonner";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Server,
  Plus,
  ShieldCheck,
  Trash2,
  RefreshCw,
  Power,
  CheckCircle2,
  AlertCircle,
  Clock,
  Lock,
  Radio,
  Copy,
  Check,
  Loader2,
} from "@/components/icons";
import type { ConnectorDTO } from "@shared/index";
import {
  useConnectors,
  useDiscoverConnectors,
  type DiscoveredRouterDTO,
  useSetConnectorMode,
  useDisconnectConnector,
  useConnectConnector,
  useDeleteConnector,
} from "./connector-hooks";
import { ConnectorDialog } from "./ConnectorDialog";

const STATUS_CONFIG: Record<
  string,
  { label: string; color: string; dot: string }
> = {
  connected: {
    label: "Terhubung",
    color: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
    dot: "bg-emerald-500 animate-pulse",
  },
  connecting: {
    label: "Menghubungkan…",
    color: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30",
    dot: "bg-amber-500 animate-ping",
  },
  failed: {
    label: "Koneksi Gagal",
    color: "bg-destructive/10 text-destructive border-destructive/30",
    dot: "bg-destructive",
  },
  disconnected: {
    label: "Terputus",
    color: "bg-muted text-muted-foreground border-border",
    dot: "bg-muted-foreground",
  },
  unverified: {
    label: "Belum Terverifikasi",
    color: "bg-muted text-muted-foreground border-border",
    dot: "bg-muted-foreground",
  },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? {
    label: status,
    color: "bg-muted text-muted-foreground border-border",
    dot: "bg-muted-foreground",
  };

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${cfg.color}`}
    >
      <span className={`size-1.5 rounded-full ${cfg.dot}`} />
      {cfg.label}
    </span>
  );
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
    <div className="flex flex-col gap-4 rounded-xl border border-border/70 bg-card/70 p-4 transition-all hover:border-border sm:flex-row sm:items-center sm:justify-between shadow-xs">
      <div className="flex min-w-0 items-start gap-3.5">
        <div
          className={`mt-1 flex size-9 shrink-0 items-center justify-center rounded-xl ${
            connected
              ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
              : "bg-muted text-muted-foreground"
          }`}
        >
          <Server className="size-5" />
        </div>

        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-foreground">
              {connector.label}
            </span>
            {connector.routerIdentity && (
              <span className="rounded-md bg-indigo-500/10 px-2 py-0.5 font-mono text-[11px] font-semibold text-indigo-600 dark:text-indigo-400">
                {connector.routerIdentity}
              </span>
            )}
            <StatusBadge status={connector.status} />
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground font-mono">
            <span>
              {connector.username}@{connector.host}:{connector.port}
            </span>
          </div>

          {connector.lastVerifiedAt && (
            <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <Clock className="size-3" />
              <span>
                Terakhir diperiksa:{" "}
                {new Date(connector.lastVerifiedAt).toLocaleString("id-ID", {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Action Controls */}
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
          <Switch
            checked={writeEnabled}
            disabled={!connected || setMode.isPending}
            onCheckedChange={onToggle}
            aria-label="Mode Write"
          />
        </label>

        {/* Connect / Disconnect */}
        {connected ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => disconnect.mutate()}
            disabled={disconnect.isPending}
            className="h-8 gap-1.5 text-xs"
          >
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
            {connect.isPending ? (
              <RefreshCw className="size-3.5 animate-spin" />
            ) : (
              <Power className="size-3.5" />
            )}
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
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setConfirmDelete(false)}
              className="h-8 px-2 text-xs"
            >
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
    </div>
  );
}

function DiscoveredRouterCard({
  device,
  onConnect,
}: {
  device: DiscoveredRouterDTO;
  onConnect: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const targetIp = device.ipv4 || device.ip;

  function copyIp() {
    navigator.clipboard.writeText(targetIp);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="relative flex flex-col justify-between rounded-xl border border-indigo-500/20 bg-card/90 p-4 shadow-xs transition-all hover:border-indigo-500/50 hover:shadow-md">
      <div>
        <div className="flex items-start justify-between gap-2 mb-2.5">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-indigo-500/10 text-indigo-500 border border-indigo-500/20">
              <Server className="size-4" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="font-semibold text-sm text-foreground truncate max-w-[140px]">
                  {device.identity || "MikroTik Router"}
                </span>
                <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground font-semibold">
                  {device.board || "CHR"}
                </span>
              </div>
              <span className="text-[11px] text-muted-foreground font-mono block truncate">
                MAC: {device.mac}
              </span>
            </div>
          </div>

          <span
            className={`shrink-0 inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full border ${
              device.sshAvailable
                ? "text-emerald-500 bg-emerald-500/10 border-emerald-500/30"
                : "text-amber-500 bg-amber-500/10 border-amber-500/30"
            }`}
          >
            <span
              className={`size-1.5 rounded-full ${
                device.sshAvailable ? "bg-emerald-500 animate-pulse" : "bg-amber-500"
              }`}
            />
            {device.sshAvailable ? "SSH Port 22 Siap" : "SSH Belum Aktif"}
          </span>
        </div>

        <div className="space-y-1.5 pt-2 border-t border-border/50 text-xs">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">IP Address:</span>
            <div className="flex items-center gap-1">
              <span className="font-mono font-bold text-foreground bg-muted/70 px-1.5 py-0.5 rounded text-xs">
                {targetIp}
              </span>
              <button
                type="button"
                onClick={copyIp}
                className="p-1 text-muted-foreground hover:text-foreground rounded transition-colors"
                title="Salin IP"
              >
                {copied ? <Check className="size-3 text-emerald-500" /> : <Copy className="size-3" />}
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between text-[11px]">
            <span className="text-muted-foreground">RouterOS:</span>
            <span className="text-foreground font-mono truncate max-w-[170px]" title={device.version}>
              {device.version || "RouterOS v7"}
            </span>
          </div>

          {device.interface && (
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-muted-foreground">Interface:</span>
              <span className="text-muted-foreground font-mono">{device.interface}</span>
            </div>
          )}
        </div>
      </div>

      <div className="pt-3 mt-3 border-t border-border/50">
        {device.alreadyAdded ? (
          <div className="flex items-center justify-center gap-1.5 py-1 text-xs font-semibold text-emerald-500 bg-emerald-500/10 rounded-lg border border-emerald-500/20">
            <CheckCircle2 className="size-3.5 text-emerald-500" />
            <span>Sudah Ditambahkan</span>
          </div>
        ) : (
          <Button
            size="sm"
            onClick={onConnect}
            className="w-full h-8 text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white gap-1.5 rounded-lg shadow-xs transition-colors"
          >
            <Plus className="size-3.5" />
            Hubungkan Router Ini
          </Button>
        )}
      </div>
    </div>
  );
}

export function ConnectorsPanel(props: { autoOpenAdd?: boolean; returnTo?: string | null; onUseInChat?: (id: string) => void } = {}) {
  const { data: connectors, isLoading, error, refetch } = useConnectors();
  const discovery = useDiscoverConnectors();
  const [dialogOpen, setDialogOpen] = useState(!!props.autoOpenAdd);
  useEffect(() => {
    if (props.autoOpenAdd) setDialogOpen(true);
  }, [props.autoOpenAdd]);
  const [prefillValues, setPrefillValues] = useState<{
    label?: string;
    host?: string;
    port?: number;
    username?: string;
  } | null>(null);

  const totalCount = (connectors ?? []).length;
  const connectedCount = (connectors ?? []).filter((c) => c.status === "connected").length;

  function handleOpenManual() {
    setPrefillValues(null);
    setDialogOpen(true);
  }

  function handleConnectDiscovered(dev: DiscoveredRouterDTO) {
    const targetIp = dev.ipv4 || dev.ip;
    setPrefillValues({
      label: `MikroTik ${dev.identity || "CHR"} (${targetIp})`,
      host: targetIp,
      port: 22,
      username: "admin",
    });
    setDialogOpen(true);
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Top Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-border/60 pb-5">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-indigo-500">
            <Server className="size-3.5" />
            Device Management
          </div>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">Connector Router</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Kelola router MikroTik target. Kredensial SSH disimpan dengan enkripsi AES-256-GCM.
          </p>
        </div>

        <Button
          onClick={handleOpenManual}
          className="gap-2 bg-indigo-600 hover:bg-indigo-500 text-white font-medium self-start sm:self-auto shadow-sm"
        >
          <Plus className="size-4" />
          Tambah Router Manual
        </Button>
      </div>

      {/* Metrics Cards */}
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-border/70 bg-card/60 p-4">
          <span className="text-xs text-muted-foreground">Total Router Terdaftar</span>
          <p className="mt-1 text-2xl font-bold font-mono">{totalCount}</p>
        </div>
        <div className="rounded-xl border border-border/70 bg-card/60 p-4">
          <span className="text-xs text-muted-foreground">Router Terhubung</span>
          <p className="mt-1 text-2xl font-bold font-mono text-emerald-500">
            {connectedCount}
          </p>
        </div>
        <div className="rounded-xl border border-border/70 bg-card/60 p-4">
          <span className="text-xs text-muted-foreground">Proteksi Transaksi</span>
          <p className="mt-1 text-sm font-semibold flex items-center gap-1.5 text-foreground">
            <ShieldCheck className="size-4 text-emerald-500" />
            Safe Mode Aktif
          </p>
        </div>
      </div>

      {/* AUTO-DISCOVERY SECTION (MikroTik MNDP / Neighbors) */}
      <div className="rounded-2xl border border-indigo-500/30 bg-gradient-to-b from-indigo-500/5 to-transparent p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="flex size-8 items-center justify-center rounded-xl bg-indigo-500/10 text-indigo-500 border border-indigo-500/20">
              <Radio className="size-4 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold text-foreground">
                  Router Terdeteksi Otomatis
                </h2>
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
            <RefreshCw
              className={`size-3.5 ${discovery.isFetching ? "animate-spin text-indigo-500" : ""}`}
            />
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
              Pastikan MikroTik RouterOS di VirtualBox/LAN sedang menyala dan MNDP aktif (IP &gt; Neighbors). Anda juga dapat menambahkan router secara manual di bawah.
            </p>
          </div>
        )}

        {!discovery.isFetching && (discovery.data ?? []).length > 0 && (
          <div className="grid gap-3 sm:grid-cols-2">
            {discovery.data!.map((dev) => (
              <DiscoveredRouterCard
                key={`${dev.mac}-${dev.ipv4 || dev.ip}`}
                device={dev}
                onConnect={() => handleConnectDiscovered(dev)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Routers List */}
      <div className="rounded-2xl border border-border/70 bg-card/40 p-5 space-y-4">
        <div className="flex items-center justify-between border-b border-border/60 pb-3">
          <h2 className="text-sm font-semibold">Daftar Router</h2>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => refetch()}
            className="h-7 text-xs gap-1 text-muted-foreground"
          >
            <RefreshCw className="size-3" />
            Segarkan
          </Button>
        </div>

        {isLoading && (
          <div className="flex items-center justify-center py-12 text-sm text-muted-foreground gap-2">
            <RefreshCw className="size-4 animate-spin text-indigo-500" />
            <span>Memuat daftar router…</span>
          </div>
        )}

        {error && (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <AlertCircle className="size-8 text-destructive mb-2" />
            <p className="text-sm font-medium text-destructive">Gagal memuat daftar router.</p>
            <p className="text-xs text-muted-foreground mt-1">
              Pastikan server backend API sedang berjalan di port 3001.
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              className="mt-3 text-xs gap-1.5"
            >
              <RefreshCw className="size-3" /> Coba Lagi
            </Button>
          </div>
        )}

        {!isLoading && !error && (connectors ?? []).length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="flex size-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground mb-3">
              <Server className="size-6" />
            </div>
            <p className="text-sm font-semibold text-foreground">Belum ada router yang ditambahkan</p>
            <p className="max-w-sm text-xs text-muted-foreground mt-1">
              Tambahkan router MikroTik Anda untuk mulai menjalankan perintah monitoring dan konfigurasi lewat AI Agent.
            </p>
            <Button
              onClick={() => setDialogOpen(true)}
              className="mt-4 gap-1.5 text-xs bg-indigo-600 hover:bg-indigo-500 text-white font-medium"
            >
              <Plus className="size-3.5" /> Tambah Router Sekarang
            </Button>
          </div>
        )}

        {props.returnTo && (
          <div className="flex items-center justify-between gap-2 rounded-xl border border-indigo-500/40 bg-indigo-500/10 px-3 py-2 text-xs">
            <span>Menambah router untuk chat — draft dan lampiran tetap tersimpan.</span>
            <a href={props.returnTo} className="font-medium text-indigo-600 hover:underline dark:text-indigo-400">
              Kembali ke chat
            </a>
          </div>
        )}
        <div className="space-y-3">
          {(connectors ?? []).map((c) => (
            <div key={c.id} className="space-y-2">
              <ConnectorRow connector={c} />
              {props.onUseInChat && c.status === "connected" && (
                <Button size="sm" variant="outline" className="w-full text-xs" onClick={() => props.onUseInChat?.(c.id)}>
                  Gunakan di chat ini
                </Button>
              )}
            </div>
          ))}
        </div>

        {/* Security footer notice */}
        <div className="flex items-start gap-2.5 rounded-xl border border-border/60 bg-muted/30 p-3.5 text-xs text-muted-foreground">
          <Lock className="size-4 text-indigo-500 shrink-0 mt-0.5" />
          <p className="leading-relaxed">
            Router baru selalu dimulai dalam mode <strong>Read-Only</strong> untuk keamanan. Mode Write
            hanya dapat diaktifkan pada koneksi yang sedang terhubung dan akan otomatis dicabut saat koneksi diputus.
          </p>
        </div>
      </div>

      <ConnectorDialog open={dialogOpen} onOpenChange={setDialogOpen} initialValues={prefillValues} />
    </div>
  );
}
