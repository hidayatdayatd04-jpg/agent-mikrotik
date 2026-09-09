import { Activity, HardDrive, Cpu } from "@/components/icons";
import type { MonitoringLiveData } from "@shared/index";
import { formatBytes } from "./monitoring-format";

export function ResourceGauges(props: { data: MonitoringLiveData }) {
  const { data } = props;
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {/* CPU Gauge */}
      <div className="monitoring-card p-5">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Cpu className="size-4 text-cyan-600 dark:text-cyan-400" />
            <span className="text-xs font-bold">Penggunaan CPU</span>
          </div>
          <span className="text-xs font-mono font-bold text-foreground">{data.cpuLoad !== null ? `${data.cpuLoad}%` : "—"}</span>
        </div>
        <div className="gauge-bar-track mt-3">
          <div
            className="gauge-bar-fill"
            style={{
              width: `${Math.min(100, data.cpuLoad ?? 0)}%`,
              backgroundColor:
                (data.cpuLoad ?? 0) > 85 ? "var(--mon-rose)" : (data.cpuLoad ?? 0) > 60 ? "var(--mon-amber)" : "var(--mon-cyan)",
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
          <span className="text-xs font-mono font-bold">{data.temperature !== null ? `${data.temperature}°C` : "Tidak tersedia"}</span>
        </div>
        <div className="gauge-bar-track mt-3">
          <div
            className="gauge-bar-fill"
            style={{
              width: `${Math.min(100, data.temperature ? (data.temperature / 80) * 100 : 0)}%`,
              backgroundColor: (data.temperature ?? 0) > 65 ? "var(--mon-rose)" : "var(--mon-green)",
            }}
          />
        </div>
        <div className="flex items-center justify-between text-[11px] text-muted-foreground mt-2.5">
          <span>Hardware Health</span>
          <span>{data.temperature ? "Normal" : "CHR / VM"}</span>
        </div>
      </div>
    </div>
  );
}
