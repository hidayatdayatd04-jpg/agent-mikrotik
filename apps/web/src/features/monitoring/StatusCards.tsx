import { Clock, Wifi, Users } from "@/components/icons";
import type { MonitoringLiveData } from "@shared/index";
import type { ConnectorDTO } from "@shared/index";

export function StatusCards(props: { data: MonitoringLiveData; selectedRouter: ConnectorDTO | undefined }) {
  const { data, selectedRouter } = props;
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {/* 1. Router State */}
      <div className="monitoring-card p-4.5">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground">Kondisi Router</span>
          <div className="flex items-center gap-1.5">
            <span className={`size-2.5 rounded-full ${data.routerOnline ? "bg-emerald-500 status-pulse" : "bg-rose-500"}`} />
            <span className="text-xs font-semibold">{data.routerOnline ? "Online" : "Offline"}</span>
          </div>
        </div>
        <div className="mt-3">
          <div className="text-lg font-bold text-foreground truncate">{data.identity || selectedRouter?.label || "Router"}</div>
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
            {data.internetOnline === true ? "Terhubung" : data.internetOnline === false ? "Terputus" : "Tidak Diketahui"}
          </div>
          <div className="text-[11px] text-muted-foreground mt-0.5">Ping test (8.8.8.8) {data.internetOnline ? "berhasil" : "gagal"}</div>
        </div>
      </div>

      {/* 3. Uptime */}
      <div className="monitoring-card p-4.5">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground">Masa Aktif (Uptime)</span>
          <Clock className="size-4 text-indigo-500" />
        </div>
        <div className="mt-3">
          <div className="text-lg font-bold truncate">{data.uptime || "—"}</div>
          <div className="text-[11px] text-muted-foreground mt-0.5">Arsitektur: {data.architecture || "—"}</div>
        </div>
      </div>

      {/* 4. Connected Clients */}
      <div className="monitoring-card p-4.5">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground">Klien Terhubung</span>
          <Users className="size-4 text-cyan-500" />
        </div>
        <div className="mt-3">
          <div className="text-lg font-bold">{data.connectedClients !== null ? `${data.connectedClients} Klien` : "—"}</div>
          <div className="text-[11px] text-muted-foreground mt-0.5">DHCP leases & ARP active</div>
        </div>
      </div>
    </div>
  );
}
