import { useMonitoringHistory } from "./monitoring-hooks";

export function HistoryChart(props: {
  connectionId: string | undefined;
  range: "1h" | "24h" | "7d";
  onRangeChange: (r: "1h" | "24h" | "7d") => void;
}) {
  const { connectionId, range: historyRange, onRangeChange: setHistoryRange } = props;
  const history = useMonitoringHistory(connectionId, historyRange);
  return (
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
        <div className="h-32 flex items-center justify-center text-xs text-muted-foreground">Memuat data historis…</div>
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
                      backgroundColor: cpu > 85 ? "var(--mon-rose)" : cpu > 60 ? "var(--mon-amber)" : "var(--mon-cyan)",
                    }}
                  />
                </div>
              );
            })}
          </div>
          <div className="flex items-center justify-between text-[10px] text-muted-foreground mt-2 border-t border-border/40 pt-1.5">
            <span>
              {history.data[0]?.collectedAt
                ? new Date(history.data[0].collectedAt).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })
                : "Lalu"}
            </span>
            <span>Waktu Sekarang</span>
          </div>
        </div>
      )}
    </div>
  );
}
