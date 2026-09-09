import { and, desc, eq, lt } from "drizzle-orm";
import type { Database } from "../../db";
import { monitoringSnapshots } from "../../db/schema";
import { sshExec } from "../ssh-exec";
import type { ConnectorService } from "../connector";
import { checkAlertThresholds, type AlertSink } from "./alerts";
import { MONITORING_COMMAND } from "./parse";
import { parseLiveData } from "./live-data";
import type { MonitoringLiveData } from "./types";

export interface MonitoringDeps {
  db: Database;
  connectors: Pick<ConnectorService, "requireOwned" | "decryptCredential">;
  exec?: typeof sshExec;
  notifications?: { create: (input: any) => Promise<any> };
}

export async function fetchLive(deps: MonitoringDeps, userId: string, connectionId: string): Promise<MonitoringLiveData> {
  const execFn = deps.exec ?? sshExec;
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
  void storeSnapshot(deps, userId, connectionId, data).catch(() => { /* ignore */ });

  // Threshold & status alert notifications
  if (deps.notifications) {
    checkAlertThresholds(deps.notifications as AlertSink, {
      userId,
      connectionId,
      routerIdentity: conn.routerIdentity,
      routerLabel: conn.label,
      data,
    });
  }

  return data;
}

export async function storeSnapshot(deps: MonitoringDeps, userId: string, connectionId: string, data: MonitoringLiveData) {
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

export async function getHistory(
  deps: MonitoringDeps,
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
