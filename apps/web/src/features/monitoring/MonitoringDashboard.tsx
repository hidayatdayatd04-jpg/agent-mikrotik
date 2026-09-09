import { useState } from "react";
import { Activity, BarChart3, AlertCircle, RefreshCw, Server } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { useConnectors } from "../connectors/connector-hooks";
import { useMonitoringLive } from "./monitoring-hooks";
import { RouterSelector } from "../connectors/RouterSelector";
import { StatusCards } from "./StatusCards";
import { ResourceGauges } from "./ResourceGauges";
import { HistoryChart } from "./HistoryChart";
import { InterfaceTable } from "./InterfaceTable";
import "./monitoring.css";

export default function MonitoringDashboard({ initialConnectionId }: { initialConnectionId?: string }) {
  const connectors = useConnectors();
  const availableConnectors = connectors.data ?? [];
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | undefined>(initialConnectionId);
  const [historyRange, setHistoryRange] = useState<"1h" | "24h" | "7d">("1h");

  // Prefer explicitly selected, then connected router, then first available
  const connectedRouter = availableConnectors.find((c) => c.status === "connected");
  const activeId = selectedConnectionId || connectedRouter?.id || availableConnectors[0]?.id;

  const live = useMonitoringLive(activeId);

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
            <p className="text-xs text-muted-foreground">Telemetri langsung dan performa router MikroTik</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <RouterSelector connectors={availableConnectors} selectedId={activeId} onSelect={(id) => setSelectedConnectionId(id)} />
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
            <StatusCards data={data} selectedRouter={selectedRouter} />

            {/* Core Resources Gauges */}
            <ResourceGauges data={data} />

            {/* Historical Resource Trends (CSS Bar Chart) */}
            <HistoryChart connectionId={activeId} range={historyRange} onRangeChange={setHistoryRange} />

            {/* Interfaces Status & Traffic Table */}
            <InterfaceTable data={data} />
          </>
        )}
      </div>
    </div>
  );
}
