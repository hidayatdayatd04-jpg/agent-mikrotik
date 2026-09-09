import type { MonitoringLiveData } from "./types";

export interface AlertSink {
  create: (input: {
    userId: string;
    connectionId: string;
    type: "warning" | "critical";
    category: "resource" | "router_status";
    title: string;
    message: string;
    routerLabel: string;
  }) => Promise<unknown>;
}

/** Threshold & status alert notifications (fire-and-forget oleh pemanggil). */
export function checkAlertThresholds(
  notifications: AlertSink,
  args: {
    userId: string;
    connectionId: string;
    routerIdentity: string | null;
    routerLabel: string;
    data: MonitoringLiveData;
  },
): void {
  const { data } = args;
  if (data.cpuLoad !== null && data.cpuLoad >= 90) {
    void notifications.create({
      userId: args.userId,
      connectionId: args.connectionId,
      type: "warning",
      category: "resource",
      title: `Beban CPU Tinggi (${data.cpuLoad}%)`,
      message: `Penggunaan CPU pada router ${args.routerIdentity || args.routerLabel} mencapai ${data.cpuLoad}%.`,
      routerLabel: args.routerLabel,
    }).catch(() => {});
  }
  if (data.memoryPercent !== null && data.memoryPercent >= 85) {
    void notifications.create({
      userId: args.userId,
      connectionId: args.connectionId,
      type: "warning",
      category: "resource",
      title: `Penggunaan RAM Tinggi (${data.memoryPercent}%)`,
      message: `Penggunaan memori RAM pada router ${args.routerIdentity || args.routerLabel} mencapai ${data.memoryPercent}%.`,
      routerLabel: args.routerLabel,
    }).catch(() => {});
  }
  if (data.internetOnline === false) {
    void notifications.create({
      userId: args.userId,
      connectionId: args.connectionId,
      type: "critical",
      category: "router_status",
      title: "Koneksi Internet Terputus",
      message: `Router ${args.routerIdentity || args.routerLabel} tidak dapat menjangkau internet (ping 8.8.8.8 gagal).`,
      routerLabel: args.routerLabel,
    }).catch(() => {});
  }
}
