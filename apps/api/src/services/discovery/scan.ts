import dgram from "node:dgram";
import { parseMndpPacket } from "./mndp";
import { checkPort, getBroadcastAddresses } from "./net";
import type { DiscoveredDevice } from "./types";

/**
 * Discovers MikroTik routers on the local network using MNDP broadcast queries.
 * Gathers neighbor responses and tests SSH availability for each router.
 */
export async function discoverMikrotikRouters(
  timeoutMs = 1500
): Promise<DiscoveredDevice[]> {
  const rawDevices = new Map<string, Omit<DiscoveredDevice, "sshAvailable">>();

  await new Promise<void>((resolve) => {
    let socket: dgram.Socket | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      if (socket) {
        try {
          socket.close();
        } catch {
          // ignore
        }
        socket = null;
      }
      resolve();
    };

    try {
      socket = dgram.createSocket({ type: "udp4", reuseAddr: true });

      socket.on("error", () => {
        cleanup();
      });

      socket.on("message", (msg, rinfo) => {
        const parsed = parseMndpPacket(msg, rinfo.address);
        if (parsed) {
          const key = `${parsed.mac}-${parsed.ipv4 || parsed.ip}`;
          if (!rawDevices.has(key)) {
            rawDevices.set(key, parsed);
          }
        }
      });

      socket.bind(5678, () => {
        if (!socket) return;
        try {
          socket.setBroadcast(true);
          const probe = Buffer.alloc(4, 0);
          const broadcasts = getBroadcastAddresses();
          for (const bcast of broadcasts) {
            socket.send(probe, 0, probe.length, 5678, bcast, () => {});
          }
        } catch {
          // non-fatal
        }
      });

      timer = setTimeout(cleanup, timeoutMs);
    } catch {
      cleanup();
    }
  });

  const deviceList = Array.from(rawDevices.values());

  // Check SSH availability concurrently with 800ms timeout
  const withSsh = await Promise.all(
    deviceList.map(async (dev) => {
      const targetIp = dev.ipv4 || dev.ip;
      const sshAvailable = await checkPort(targetIp, 22, 800);
      return {
        ...dev,
        sshAvailable,
      };
    })
  );

  return withSsh;
}
