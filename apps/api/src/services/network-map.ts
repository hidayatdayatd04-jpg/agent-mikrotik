import type { NetworkMapSnapshot } from "@shared/network-map";
import { AppError } from "../lib/errors";
import type { ConnectorService } from "./connector";
import type { TargetPolicy } from "./target-policy";
import { sshExec } from "./ssh-exec";
import { NETWORK_READ_COMMAND, parseNetworkRead } from "./network-map-reader";
import { buildNetworkMap } from "./network-map-model";

export function createNetworkMapService(deps: {
  connectors: Pick<ConnectorService, "requireOwned" | "decryptCredential">;
  targetPolicy: TargetPolicy;
  exec?: typeof sshExec;
  now?: () => number;
}) {
  const now = deps.now ?? Date.now;
  const cache = new Map<string, { revision: string; at: number; snapshot: NetworkMapSnapshot }>();
  const pending = new Map<string, { revision: string; promise: Promise<NetworkMapSnapshot> }>();
  const attempts = new Map<string, number>();
  const revisionOf = (row: Awaited<ReturnType<ReturnType<ConnectorService["requireOwned"]>>>) =>
    [row.host, row.port, row.username, row.hostKeyFingerprint, row.updatedAt.getTime(), row.lastVerifiedAt?.getTime(), row.passwordCiphertext].join("|");

  async function read(userId: string, connectionId: string, refresh = false): Promise<NetworkMapSnapshot> {
    // Ownership and connection state checked even on cache hits.
    const conn = await deps.connectors.requireOwned(userId, connectionId)();
    const key = `${userId}:${connectionId}`;
    const revision = revisionOf(conn);
    if (conn.status !== "connected") {
      cache.delete(key);
      return { connectionId, collectedAt: new Date(now()).toISOString(), state: "disconnected", message: "Router belum terkoneksi. Sambungkan melalui Connector.",
        nodes: [], edges: [], datasets: [], warnings: [], cached: false };
    }
    for (const [k, entry] of cache) if (now() - entry.at > 60_000) cache.delete(k);
    for (const [k, at] of attempts) if (now() - at > 60_000) attempts.delete(k);
    const entry = cache.get(key);
    if (entry && entry.revision === revision && (!refresh || now() - entry.at < 5_000)) return { ...entry.snapshot, cached: true };
    const flight = pending.get(key);
    if (flight) {
      if (flight.revision === revision) return flight.promise;
      throw new AppError("CONFLICT", "Connector berubah saat pembacaan. Coba lagi setelah pembacaan selesai.", 409);
    }
    if (now() - (attempts.get(key) ?? -Infinity) < 5_000 || pending.size >= 4) {
      throw new AppError("RATE_LIMITED", "Pembacaan topologi sedang dibatasi. Coba lagi dalam beberapa detik.", 429);
    }
    attempts.set(key, now());
    const promise = (async () => {
      const decision = await deps.targetPolicy.check(conn.host);
      if (!decision.allowed) throw new AppError("HOST_NOT_ALLOWED", "Target connector tidak diizinkan untuk pembacaan topologi.", 400);
      const password = await deps.connectors.decryptCredential(userId, connectionId);
      let result: Awaited<ReturnType<typeof sshExec>>;
      try {
        result = await (deps.exec ?? sshExec)({ host: decision.ip, port: conn.port, username: conn.username, password,
          expectFingerprint: conn.hostKeyFingerprint, command: NETWORK_READ_COMMAND, timeoutMs: 25_000, maxOutputChars: 2_000_000 });
      } catch (error) {
        cache.delete(key);
        if (error instanceof AppError && ["SSH_TIMEOUT", "HOST_KEY_CHANGED", "SSH_AUTH_FAILED"].includes(error.code)) throw error;
        throw new AppError("SSH_UNREACHABLE", "Router tidak dapat dijangkau untuk membaca topologi. Periksa koneksi SSH melalui Connector.", 502);
      }
      const current = await deps.connectors.requireOwned(userId, connectionId)();
      if (current.status !== "connected" || revisionOf(current) !== revision) {
        cache.delete(key);
        throw new AppError("CONFLICT", "Connector berubah saat pembacaan. Muat ulang topologi.", 409);
      }
      const parsed = parseNetworkRead(result.output);
      const snapshot = buildNetworkMap(parsed.tables, { connectionId, host: conn.host, collectedAt: new Date(now()).toISOString(), datasets: parsed.datasets });
      if (result.truncated || (result.exitCode !== null && result.exitCode !== 0)) {
        snapshot.warnings.push("Pembacaan SSH tidak lengkap. Hanya bagian yang selesai yang ditampilkan; jumlah perangkat merupakan batas bawah.");
        snapshot.state = snapshot.nodes.length ? "partial" : "error";
      }
      if (cache.size >= 20) cache.delete(cache.keys().next().value!);
      cache.set(key, { revision, at: now(), snapshot });
      return snapshot;
    })();
    pending.set(key, { revision, promise });
    try { return await promise; } finally { pending.delete(key); }
  }
  return { read };
}
export type NetworkMapService = ReturnType<typeof createNetworkMapService>;
