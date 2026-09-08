import type { Database } from "../db";
import { monitoringSnapshots } from "../db/schema";
import { eq, and, lt, desc } from "drizzle-orm";
import { sshExec } from "./ssh-exec";
import type { ConnectorService } from "./connector";
import { parseValueList } from "@mikrotik-tools/index";

export interface MonitoringLiveData {
  identity: string | null;
  model: string | null;
  rosVersion: string | null;
  architecture: string | null;
  uptime: string | null;
  cpuLoad: number | null;
  cpuCount: number | null;
  freeMemory: number | null;
  totalMemory: number | null;
  memoryPercent: number | null;
  temperature: number | null;
  routerOnline: boolean;
  internetOnline: boolean | null;
  interfaces: InterfaceInfo[];
  connectedClients: number | null;
  collectedAt: string;
}

export interface InterfaceInfo {
  name: string;
  type: string;
  status: string; // up | down | disabled
  rxBytes: number;
  txBytes: number;
  rxRate: string | null;
  txRate: string | null;
  macAddress: string | null;
}

const MONITORING_COMMAND = [
  ":put \"===RESOURCE===\"",
  "/system resource print",
  ":put \"===IDENTITY===\"",
  "/system identity print",
  ":put \"===HEALTH===\"",
  "/system health print",
  ":put \"===INTERFACES===\"",
  "/interface print detail",
  ":put \"===DHCP===\"",
  "/ip dhcp-server lease print count-only",
  ":put \"===ARP===\"",
  "/ip arp print count-only",
  ":put \"===PING===\"",
  "/ping 8.8.8.8 count=1",
].join("; ");

function parseSection(output: string, tag: string): string {
  const startTag = `===${tag}===`;
  const startIdx = output.indexOf(startTag);
  if (startIdx === -1) return "";
  const content = output.substring(startIdx + startTag.length);
  const nextTag = content.indexOf("===");
  return nextTag === -1 ? content.trim() : content.substring(0, nextTag).trim();
}

function parseNumber(value: string | undefined): number | null {
  if (!value) return null;
  // Handle MiB/KiB suffixes
  const cleaned = value.replace(/[^0-9.]/g, "");
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

function parseUptime(value: string | undefined): string | null {
  if (!value) return null;
  return value.trim();
}

function parseCpuLoad(value: string | undefined): number | null {
  if (!value) return null;
  const num = parseInt(value.replace("%", ""), 10);
  return isNaN(num) ? null : Math.min(100, Math.max(0, num));
}

function parseMemoryBytes(value: string | undefined): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  // RouterOS reports memory in bytes or MiB
  if (/MiB$/i.test(trimmed)) {
    const num = parseFloat(trimmed.replace(/MiB$/i, ""));
    return isNaN(num) ? null : Math.round(num * 1024 * 1024);
  }
  if (/KiB$/i.test(trimmed)) {
    const num = parseFloat(trimmed.replace(/KiB$/i, ""));
    return isNaN(num) ? null : Math.round(num * 1024);
  }
  const num = parseFloat(trimmed);
  return isNaN(num) ? null : Math.round(num);
}

function parseColonKeyValue(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const colonIdx = trimmed.indexOf(":");
    if (colonIdx > 0) {
      const k = trimmed.substring(0, colonIdx).trim().toLowerCase();
      const v = trimmed.substring(colonIdx + 1).trim();
      result[k] = v;
    }
  }
  return result;
}

export function parseLiveData(raw: string, routerInfo: { identity?: string | null; rosVersion?: string | null; boardName?: string | null; architecture?: string | null }): MonitoringLiveData {
  const resourceSection = parseSection(raw, "RESOURCE");
  const identitySection = parseSection(raw, "IDENTITY");
  const healthSection = parseSection(raw, "HEALTH");
  const interfaceSection = parseSection(raw, "INTERFACES");
  const dhcpSection = parseSection(raw, "DHCP");
  const arpSection = parseSection(raw, "ARP");
  const pingSection = parseSection(raw, "PING");

  // Parse resource (RouterOS /system resource print uses "key: value" format)
  const resColon = parseColonKeyValue(resourceSection);
  const resParsed = parseValueList(resourceSection).rows[0]?.fields ?? {};
  const res = { ...resParsed, ...resColon };

  const cpuLoad = parseCpuLoad(res["cpu-load"]);
  const freeMemory = parseMemoryBytes(res["free-memory"]);
  const totalMemory = parseMemoryBytes(res["total-memory"]);
  const cpuCount = parseNumber(res["cpu-count"]);
  const uptime = parseUptime(res["uptime"]);

  // Parse identity (/system identity print uses "name: ...")
  const idColon = parseColonKeyValue(identitySection);
  const idParsed = parseValueList(identitySection).rows[0]?.fields ?? {};
  const rawId = (idColon["name"] ?? idParsed["name"] ?? routerInfo.identity ?? null) as string | null;
  const identity = rawId ? rawId.replace(/^"|"$/g, "") : null;

  // Parse health (temperature)
  const healthColon = parseColonKeyValue(healthSection);
  let temperature: number | null = null;
  if (healthColon["temperature"] || healthColon["cpu-temperature"]) {
    temperature = parseNumber(healthColon["temperature"] ?? healthColon["cpu-temperature"] ?? "");
  } else {
    for (const row of parseValueList(healthSection).rows) {
      const f = row.fields;
      const name = String(f.name ?? f.type ?? "").toLowerCase();
      if (name.includes("temperature")) {
        temperature = parseNumber(String(f.value ?? ""));
        break;
      }
    }
  }

  // Parse interfaces
  const ifRows = parseValueList(interfaceSection).rows;
  const interfaces: InterfaceInfo[] = ifRows.map((row) => {
    const f = row.fields;
    const isRunning = row.flags.includes("R") || f.running === "true" || f.running === "yes";
    const isDisabled = row.flags.includes("X") || f.disabled === "true" || f.disabled === "yes";
    return {
      name: String(f.name ?? ""),
      type: String(f.type ?? "ether"),
      status: isRunning ? "up" : isDisabled ? "disabled" : "down",
      rxBytes: parseNumber(String(f["rx-byte"] ?? f["rx-bytes"] ?? "0")) ?? 0,
      txBytes: parseNumber(String(f["tx-byte"] ?? f["tx-bytes"] ?? "0")) ?? 0,
      rxRate: (f["rx-rate"] ?? f["rx-bits-per-second"] ?? null) as string | null,
      txRate: (f["tx-rate"] ?? f["tx-bits-per-second"] ?? null) as string | null,
      macAddress: (f["mac-address"] ?? null) as string | null,
    };
  }).filter((i) => i.name);

  // Count connected clients
  const dhcpCount = parseNumber(dhcpSection.split("\n").map((l) => l.trim()).find((l) => /^\d+$/.test(l)) ?? "") ?? 0;
  const arpCount = parseNumber(arpSection.split("\n").map((l) => l.trim()).find((l) => /^\d+$/.test(l)) ?? "") ?? 0;
  const connectedClients = Math.max(dhcpCount, arpCount) || null;

  // Internet check: ping success
  const pingSuccess = /time=\d+/i.test(pingSection) || /received=1/i.test(pingSection);
  const pingFailed = /timeout|0 received|no route/i.test(pingSection);
  const internetOnline = pingSuccess ? true : pingFailed ? false : null;

  return {
    identity,
    model: res["board-name"] ?? routerInfo.boardName ?? null,
    rosVersion: routerInfo.rosVersion ?? res["version"] ?? null,
    architecture: routerInfo.architecture ?? res["architecture"] ?? res["architecture-name"] ?? null,
    uptime,
    cpuLoad,
    cpuCount: cpuCount ?? 1,
    freeMemory,
    totalMemory,
    memoryPercent: freeMemory !== null && totalMemory !== null && totalMemory > 0
      ? Math.round(((totalMemory - freeMemory) / totalMemory) * 100)
      : null,
    temperature,
    routerOnline: true,
    internetOnline,
    interfaces,
    connectedClients,
    collectedAt: new Date().toISOString(),
  };
}

export function createMonitoringService(deps: {
  db: Database;
  connectors: Pick<ConnectorService, "requireOwned" | "decryptCredential">;
  exec?: typeof sshExec;
  notifications?: { create: (input: any) => Promise<any> };
}) {
  const execFn = deps.exec ?? sshExec;

  async function fetchLive(userId: string, connectionId: string): Promise<MonitoringLiveData> {
    const conn = await deps.connectors.requireOwned(userId, connectionId)();
    if (conn.status !== "connected") {
      return {
        identity: conn.routerIdentity ?? null,
        model: conn.boardName ?? null,
        rosVersion: conn.rosVersion ?? null,
        architecture: conn.architecture ?? null,
        uptime: null, cpuLoad: null, cpuCount: null,
        freeMemory: null, totalMemory: null, memoryPercent: null,
        temperature: null, routerOnline: false, internetOnline: null,
        interfaces: [], connectedClients: null,
        collectedAt: new Date().toISOString(),
      };
    }
    const password = await deps.connectors.decryptCredential(userId, connectionId);
    const result = await execFn({
      host: conn.host,
      port: conn.port,
      username: conn.username,
      password,
      command: MONITORING_COMMAND,
      timeoutMs: 20_000,
      maxOutputChars: 500_000,
    });
    const data = parseLiveData(result.output, {
      identity: conn.routerIdentity,
      rosVersion: conn.rosVersion,
      boardName: conn.boardName,
      architecture: conn.architecture,
    });

    // Store snapshot for history (async, don't block response)
    void storeSnapshot(userId, connectionId, data).catch(() => { /* ignore */ });

    // Threshold & status alert notifications
    if (deps.notifications) {
      if (data.cpuLoad !== null && data.cpuLoad >= 90) {
        void deps.notifications.create({
          userId,
          connectionId,
          type: "warning",
          category: "resource",
          title: `Beban CPU Tinggi (${data.cpuLoad}%)`,
          message: `Penggunaan CPU pada router ${conn.routerIdentity || conn.label} mencapai ${data.cpuLoad}%.`,
          routerLabel: conn.label,
        }).catch(() => {});
      }
      if (data.memoryPercent !== null && data.memoryPercent >= 85) {
        void deps.notifications.create({
          userId,
          connectionId,
          type: "warning",
          category: "resource",
          title: `Penggunaan RAM Tinggi (${data.memoryPercent}%)`,
          message: `Penggunaan memori RAM pada router ${conn.routerIdentity || conn.label} mencapai ${data.memoryPercent}%.`,
          routerLabel: conn.label,
        }).catch(() => {});
      }
      if (data.internetOnline === false) {
        void deps.notifications.create({
          userId,
          connectionId,
          type: "critical",
          category: "router_status",
          title: "Koneksi Internet Terputus",
          message: `Router ${conn.routerIdentity || conn.label} tidak dapat menjangkau internet (ping 8.8.8.8 gagal).`,
          routerLabel: conn.label,
        }).catch(() => {});
      }
    }

    return data;
  }

  async function storeSnapshot(userId: string, connectionId: string, data: MonitoringLiveData) {
    const now = new Date();
    await deps.db.insert(monitoringSnapshots).values({
      connectionId,
      userId,
      type: "resource",
      data: {
        cpuLoad: data.cpuLoad,
        memoryPercent: data.memoryPercent,
        temperature: data.temperature,
        connectedClients: data.connectedClients,
        internetOnline: data.internetOnline,
        interfaces: data.interfaces.map((i) => ({
          name: i.name, status: i.status, rxBytes: i.rxBytes, txBytes: i.txBytes,
        })),
      },
      collectedAt: now,
    });

    // Prune old snapshots (older than 7 days)
    const cutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    await deps.db.delete(monitoringSnapshots).where(
      and(
        eq(monitoringSnapshots.connectionId, connectionId),
        lt(monitoringSnapshots.collectedAt, cutoff),
      ),
    );
  }

  async function getHistory(
    userId: string,
    connectionId: string,
    range: "1h" | "24h" | "7d" = "1h",
  ) {
    // Verify ownership
    await deps.connectors.requireOwned(userId, connectionId)();

    const now = Date.now();
    const msMap = { "1h": 60 * 60 * 1000, "24h": 24 * 60 * 60 * 1000, "7d": 7 * 24 * 60 * 60 * 1000 };
    const since = new Date(now - msMap[range]);

    const rows = await deps.db
      .select()
      .from(monitoringSnapshots)
      .where(
        and(
          eq(monitoringSnapshots.connectionId, connectionId),
          eq(monitoringSnapshots.type, "resource"),
        ),
      )
      .orderBy(desc(monitoringSnapshots.collectedAt))
      .limit(range === "1h" ? 120 : range === "24h" ? 288 : 336); // ~every 30s/5min/30min

    return rows
      .filter((r) => r.collectedAt >= since)
      .map((r) => ({
        data: r.data as Record<string, unknown>,
        collectedAt: r.collectedAt.toISOString(),
      }))
      .reverse();
  }

  return { fetchLive, getHistory };
}

export type MonitoringService = ReturnType<typeof createMonitoringService>;
