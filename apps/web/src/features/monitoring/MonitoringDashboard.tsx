import { useState } from "react";
import {
  Activity,
  BarChart3,
  Clock,
  AlertCircle,
  RefreshCw,
  Server,
  Wifi,
  Users,
  HardDrive,
  Cpu,
} from "@/components/icons";
import { Button } from "@/components/ui/button";
import { useConnectors } from "../connectors/connector-hooks";
import { useMonitoringLive, useMonitoringHistory } from "./monitoring-hooks";
import { RouterSelector } from "../connectors/RouterSelector";
import "./monitoring.css";

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

export default function MonitoringDashboard({ initialConnectionId }: { initialConnectionId?: string }) {
  const connectors = useConnectors();
  const availableConnectors = connectors.data ?? [];
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | undefined>(initialConnectionId);
  const [historyRange, setHistoryRange] = useState<"1h" | "24h" | "7d">("1h");

  // Prefer explicitly selected, then connected router, then first available
  const connectedRouter = availableConnectors.find((c) => c.status === "connected");
  const activeId = selectedConnectionId || connectedRouter?.id || availableConnectors[0]?.id;

  const live = useMonitoringLive(activeId);
  const history = useMonitoringHistory(activeId, historyRange);

  const selectedRouter = availableConnectors.find((c) => c.id === activeId);

  const data = live.data;

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background text-foreground monitoring-container">
      {/* Top Header */}
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-border/60 bg-background/80 px-6 py-3.5 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-xl bg-cyan-500/10 text-cyan-600 dark:text-cyan-400">
            <BarChart3 className="size-5" />
          </div>
          <div>
            <h1 className="text-base font-bold leading-tight">Monitoring Dashboard</h1>
            <p className="text-xs text-muted-foreground">
              Telemetri langsung dan performa router MikroTik
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <RouterSelector
            connectors={availableConnectors}
            selectedId={activeId}
            onSelect={(id) => setSelectedConnectionId(id)}
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => void live.refetch()}
            disabled={live.isFetching}
            className="gap-1.5 text-xs h-9 rounded-xl cursor-pointer"
          >
            <RefreshCw className={`size-3.5 ${live.isFetching ? "animate-spin" : ""}`} />
            <span>Segarkan</span>
          </Button>
        </div>
      </header>

      {/* Main Scrollable Dashboard */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6 max-w-7xl mx-auto w-full">
        {!activeId ? (
          <div className="flex flex-col items-center justify-center h-80 text-center">
            <Server className="size-10 text-muted-foreground/50 mb-3" />
            <h3 className="text-sm font-semibold">Pilih Router</h3>
            <p className="text-xs text-muted-foreground mt-1 max-w-sm">
              Pilih salah satu koneksi router MikroTik aktif untuk melihat status dan metrik langsung.
            </p>
          </div>
        ) : live.isLoading ? (
          <div className="flex flex-col items-center justify-center h-80 text-center">
            <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10 animate-pulse text-primary mb-3">
              <Activity className="size-5" />
            </div>
            <p className="text-sm font-semibold">Mengambil data telemetri…</p>
            <p className="text-xs text-muted-foreground mt-1">Menghubungkan langsung melalui sesi RouterOS.</p>
          </div>
        ) : live.isError ? (
          <div className="flex flex-col items-center justify-center h-80 text-center">
            <AlertCircle className="size-10 text-destructive mb-3" />
            <p className="text-sm font-semibold text-destructive">Gagal Memuat Monitoring</p>
            <p className="text-xs text-muted-foreground mt-1 max-w-md">
              {(live.error as Error)?.message || "Tidak dapat mengambil data dari router. Pastikan koneksi SSH aktif."}
            </p>
            <Button size="sm" variant="outline" onClick={() => live.refetch()} className="mt-4">
              Coba Lagi
            </Button>
          </div>
        ) : !data ? null : (
          <>
            {/* Overview Status Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* 1. Router State */}
              <div className="monitoring-card p-4.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground">Kondisi Router</span>
                  <div className="flex items-center gap-1.5">
                    <span
                      className={`size-2.5 rounded-full ${
                        data.routerOnline ? "bg-emerald-500 status-pulse" : "bg-rose-500"
                      }`}
                    />
                    <span className="text-xs font-semibold">
                      {data.routerOnline ? "Online" : "Offline"}
                    </span>
                  </div>
                </div>
                <div className="mt-3">
                  <div className="text-lg font-bold text-foreground truncate">
                    {data.identity || selectedRouter?.label || "Router"}
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-0.5 truncate">
                    {data.model || selectedRouter?.boardName || "MikroTik"} · RouterOS v{data.rosVersion || selectedRouter?.rosVersion || "—"}
                  </div>
                </div>
              </div>

              {/* 2. Internet Connectivity */}
              <div className="monitoring-card p-4.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground">Konektivitas Internet</span>
                  <Wifi className={`size-4 ${data.internetOnline ? "text-emerald-500" : "text-amber-500"}`} />
                </div>
                <div className="mt-3">
                  <div className="text-lg font-bold">
                    {data.internetOnline === true
                      ? "Terhubung"
                      : data.internetOnline === false
                        ? "Terputus"
                        : "Tidak Diketahui"}
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">
                    Ping test (8.8.8.8) {data.internetOnline ? "berhasil" : "gagal"}
                  </div>
                </div>
              </div>

              {/* 3. Uptime */}
              <div className="monitoring-card p-4.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground">Masa Aktif (Uptime)</span>
                  <Clock className="size-4 text-indigo-500" />
                </div>
                <div className="mt-3">
                  <div className="text-lg font-bold truncate">
                    {data.uptime || "—"}
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">
                    Arsitektur: {data.architecture || "—"}
                  </div>
                </div>
              </div>

              {/* 4. Connected Clients */}
              <div className="monitoring-card p-4.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground">Klien Terhubung</span>
                  <Users className="size-4 text-cyan-500" />
                </div>
                <div className="mt-3">
                  <div className="text-lg font-bold">
                    {data.connectedClients !== null ? `${data.connectedClients} Klien` : "—"}
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">
                    DHCP leases & ARP active
                  </div>
                </div>
              </div>
            </div>

            {/* Core Resources Gauges */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* CPU Gauge */}
              <div className="monitoring-card p-5">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Cpu className="size-4 text-cyan-600 dark:text-cyan-400" />
                    <span className="text-xs font-bold">Penggunaan CPU</span>
                  </div>
                  <span className="text-xs font-mono font-bold text-foreground">
                    {data.cpuLoad !== null ? `${data.cpuLoad}%` : "—"}
                  </span>
                </div>
                <div className="gauge-bar-track mt-3">
                  <div
                    className="gauge-bar-fill"
                    style={{
                      width: `${Math.min(100, data.cpuLoad ?? 0)}%`,
                      backgroundColor:
                        (data.cpuLoad ?? 0) > 85
                          ? "var(--mon-rose)"
                          : (data.cpuLoad ?? 0) > 60
                            ? "var(--mon-amber)"
                            : "var(--mon-cyan)",
                    }}
                  />
                </div>
                <div className="flex items-center justify-between text-[11px] text-muted-foreground mt-2.5">
                  <span>Jumlah Core: {data.cpuCount || 1}</span>
                  <span>Ambang: 90%</span>
                </div>
              </div>

              {/* Memory / RAM Gauge */}
              <div className="monitoring-card p-5">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <HardDrive className="size-4 text-indigo-600 dark:text-indigo-400" />
                    <span className="text-xs font-bold">Penggunaan RAM</span>
                  </div>
                  <span className="text-xs font-mono font-bold text-foreground">
                    {data.memoryPercent !== null ? `${data.memoryPercent}%` : "—"}
                  </span>
                </div>
                <div className="gauge-bar-track mt-3">
                  <div
                    className="gauge-bar-fill"
                    style={{
                      width: `${Math.min(100, data.memoryPercent ?? 0)}%`,
                      backgroundColor:
                        (data.memoryPercent ?? 0) > 85
                          ? "var(--mon-rose)"
                          : (data.memoryPercent ?? 0) > 65
                            ? "var(--mon-amber)"
                            : "var(--mon-indigo)",
                    }}
                  />
                </div>
                <div className="flex items-center justify-between text-[11px] text-muted-foreground mt-2.5">
                  <span>Bebas: {data.freeMemory ? formatBytes(data.freeMemory) : "—"}</span>
                  <span>Total: {data.totalMemory ? formatBytes(data.totalMemory) : "—"}</span>
                </div>
              </div>

              {/* Temperature & Health */}
              <div className="monitoring-card p-5">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Activity className="size-4 text-emerald-600 dark:text-emerald-400" />
                    <span className="text-xs font-bold">Suhu & Kesehatan</span>
                  </div>
                  <span className="text-xs font-mono font-bold">
                    {data.temperature !== null ? `${data.temperature}°C` : "Tidak tersedia"}
                  </span>
                </div>
                <div className="gauge-bar-track mt-3">
                  <div
                    className="gauge-bar-fill"
                    style={{
                      width: `${Math.min(100, data.temperature ? (data.temperature / 80) * 100 : 0)}%`,
                      backgroundColor:
                        (data.temperature ?? 0) > 65 ? "var(--mon-rose)" : "var(--mon-green)",
                    }}
                  />
                </div>
                <div className="flex items-center justify-between text-[11px] text-muted-foreground mt-2.5">
                  <span>Hardware Health</span>
                  <span>{data.temperature ? "Normal" : "CHR / VM"}</span>
                </div>
              </div>
            </div>

            {/* Historical Resource Trends (CSS Bar Chart) */}
            <div className="monitoring-card p-5">
              <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-border/50">
                <div>
                  <h3 className="text-xs font-bold">Tren Beban CPU Historis</h3>
                  <p className="text-[11px] text-muted-foreground">Snapshot performa tersimpan secara berkala</p>
                </div>
                <div className="flex items-center gap-1.5 bg-muted/50 p-1 rounded-lg">
                  {(["1h", "24h", "7d"] as const).map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setHistoryRange(r)}
                      className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors cursor-pointer ${
                        historyRange === r
                          ? "bg-background text-foreground shadow-xs font-bold"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {r === "1h" ? "1 Jam" : r === "24h" ? "24 Jam" : "7 Hari"}
                    </button>
                  ))}
                </div>
              </div>

              {history.isLoading ? (
                <div className="h-32 flex items-center justify-center text-xs text-muted-foreground">
                  Memuat data historis…
                </div>
              ) : !history.data || history.data.length === 0 ? (
                <div className="h-32 flex flex-col items-center justify-center text-xs text-muted-foreground">
                  <span>Belum ada snapshot historis tersimpan.</span>
                  <span className="text-[10px] mt-0.5">Data dikumpulkan otomatis setiap polling.</span>
                </div>
              ) : (
                <div className="pt-3">
                  <div className="history-bar-chart">
                    {history.data.map((item, idx) => {
                      const cpu = typeof item.data.cpuLoad === "number" ? item.data.cpuLoad : 5;
                      return (
                        <div
                          key={idx}
                          className="history-bar-column group"
                          title={`${new Date(item.collectedAt).toLocaleTimeString("id-ID")} · CPU: ${cpu}%`}
                        >
                          <div
                            className="history-bar-fill"
                            style={{
                              height: `${Math.max(6, cpu)}%`,
                              backgroundColor:
                                cpu > 85 ? "var(--mon-rose)" : cpu > 60 ? "var(--mon-amber)" : "var(--mon-cyan)",
                            }}
                          />
                        </div>
                      );
                    })}
                  </div>
                  <div className="flex items-center justify-between text-[10px] text-muted-foreground mt-2 border-t border-border/40 pt-1.5">
                    <span>{history.data[0]?.collectedAt ? new Date(history.data[0].collectedAt).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }) : "Lalu"}</span>
                    <span>Waktu Sekarang</span>
                  </div>
                </div>
              )}
            </div>

            {/* Interfaces Status & Traffic Table */}
            <div className="monitoring-card overflow-hidden">
              <div className="px-5 py-4 border-b border-border/50 flex items-center justify-between">
                <div>
                  <h3 className="text-xs font-bold">Status Interface & Trafik</h3>
                  <p className="text-[11px] text-muted-foreground">Daftar interface aktif, throughput, dan status link</p>
                </div>
                <span className="text-[11px] font-semibold text-muted-foreground">
                  {data.interfaces.length} Interface Terdeteksi
                </span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-border/40 bg-muted/20 text-muted-foreground text-[11px]">
                      <th className="px-5 py-2.5 font-semibold">Nama Interface</th>
                      <th className="px-4 py-2.5 font-semibold">Tipe</th>
                      <th className="px-4 py-2.5 font-semibold">Status</th>
                      <th className="px-4 py-2.5 font-semibold">Trafik RX</th>
                      <th className="px-4 py-2.5 font-semibold">Trafik TX</th>
                      <th className="px-4 py-2.5 font-semibold">MAC Address</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/30">
                    {data.interfaces.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-5 py-6 text-center text-muted-foreground">
                          Tidak ada interface ditemukan.
                        </td>
                      </tr>
                    ) : (
                      data.interfaces.map((iface) => (
                        <tr key={iface.name} className="hover:bg-accent/30 transition-colors">
                          <td className="px-5 py-3 font-semibold text-foreground flex items-center gap-2">
                            <span
                              className={`size-2 rounded-full shrink-0 ${
                                iface.status === "up"
                                  ? "bg-emerald-500"
                                  : iface.status === "down"
                                    ? "bg-rose-500"
                                    : "bg-muted-foreground"
                              }`}
                            />
                            {iface.name}
                          </td>
                          <td className="px-4 py-3 text-muted-foreground font-mono text-[11px]">
                            {iface.type}
                          </td>
                          <td className="px-4 py-3">
                            <span
                              className={`inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-semibold ${
                                iface.status === "up"
                                  ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                                  : iface.status === "down"
                                    ? "bg-rose-500/10 text-rose-600 dark:text-rose-400"
                                    : "bg-muted text-muted-foreground"
                              }`}
                            >
                              {iface.status.toUpperCase()}
                            </span>
                          </td>
                          <td className="px-4 py-3 font-mono text-[11px]">
                            {formatBytes(iface.rxBytes)}
                          </td>
                          <td className="px-4 py-3 font-mono text-[11px]">
                            {formatBytes(iface.txBytes)}
                          </td>
                          <td className="px-4 py-3 font-mono text-[11px] text-muted-foreground">
                            {iface.macAddress || "—"}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
