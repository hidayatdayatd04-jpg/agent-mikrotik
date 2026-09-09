import type { MonitoringLiveData } from "@shared/index";
import { formatBytes } from "./monitoring-format";

export function InterfaceTable(props: { data: MonitoringLiveData }) {
  const { data } = props;
  return (
    <div className="monitoring-card overflow-hidden">
      <div className="px-5 py-4 border-b border-border/50 flex items-center justify-between">
        <div>
          <h3 className="text-xs font-bold">Status Interface & Trafik</h3>
          <p className="text-[11px] text-muted-foreground">Daftar interface aktif, throughput, dan status link</p>
        </div>
        <span className="text-[11px] font-semibold text-muted-foreground">{data.interfaces.length} Interface Terdeteksi</span>
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
                        iface.status === "up" ? "bg-emerald-500" : iface.status === "down" ? "bg-rose-500" : "bg-muted-foreground"
                      }`}
                    />
                    {iface.name}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground font-mono text-[11px]">{iface.type}</td>
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
                  <td className="px-4 py-3 font-mono text-[11px]">{formatBytes(iface.rxBytes)}</td>
                  <td className="px-4 py-3 font-mono text-[11px]">{formatBytes(iface.txBytes)}</td>
                  <td className="px-4 py-3 font-mono text-[11px] text-muted-foreground">{iface.macAddress || "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
