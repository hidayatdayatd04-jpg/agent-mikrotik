import type { ConnectorDTO } from "@shared/index";

export const LOCAL_HELP = `Perintah RouterOS (contoh):
  /system identity print          info router
  /interface print                daftar interface
  /ip address print               alamat IP
  /ip route print                 tabel routing
  ping 8.8.8.8                    ping (otomatis count=4)
  /log print                      log sistem
  /export                         konfigurasi

Lokal: clear, history, help, exit`;

export interface Line {
  key: string;
  kind: "input" | "output" | "error" | "info" | "running";
  text: string;
}

export function promptLabel(connector: ConnectorDTO | null): string {
  if (!connector) return "[disconnected] >";
  const user = connector.username || "admin";
  const host = connector.routerIdentity || connector.host;
  return `[${user}@${host}] >`;
}
