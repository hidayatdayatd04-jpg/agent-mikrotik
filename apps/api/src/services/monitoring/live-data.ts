import { parseValueList } from "@mikrotik-tools/index";
import {
  parseColonKeyValue,
  parseCpuLoad,
  parseMemoryBytes,
  parseNumber,
  parseSection,
  parseUptime,
} from "./parse";
import type { InterfaceInfo, MonitoringLiveData, RouterInfo } from "./types";

export function parseLiveData(raw: string, routerInfo: RouterInfo): MonitoringLiveData {
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
