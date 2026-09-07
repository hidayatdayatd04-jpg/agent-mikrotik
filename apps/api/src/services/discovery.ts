import dgram from "node:dgram";
import os from "node:os";
import net from "node:net";

export interface DiscoveredDevice {
  ip: string;
  mac: string;
  identity: string;
  version: string;
  platform: string;
  board: string;
  interface: string;
  ipv4: string;
  uptimeSeconds?: number;
  sshAvailable: boolean;
}

/**
 * Calculates broadcast addresses for all active IPv4 network interfaces
 * plus the global 255.255.255.255.
 */
export function getBroadcastAddresses(): string[] {
  const broadcasts = new Set<string>(["255.255.255.255"]);
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name] ?? []) {
      if (iface.family === "IPv4" && !iface.internal && iface.netmask) {
        const ipParts = iface.address.split(".").map(Number);
        const maskParts = iface.netmask.split(".").map(Number);
        if (ipParts.length === 4 && maskParts.length === 4) {
          const bcastParts = ipParts.map(
            (b, i) => ((b | (~maskParts[i]! & 255)) >>> 0) & 255
          );
          broadcasts.add(bcastParts.join("."));
        }
      }
    }
  }
  return Array.from(broadcasts);
}

/**
 * Parses an incoming MikroTik Neighbor Discovery Protocol (MNDP) UDP packet.
 * MNDP operates on UDP port 5678 and encodes TLV entries with 16-bit big-endian headers.
 */
export function parseMndpPacket(
  buf: Buffer,
  remoteIp: string
): Omit<DiscoveredDevice, "sshAvailable"> | null {
  if (buf.length < 4) return null;
  let offset = 4; // Skip 4-byte MNDP header
  const result = {
    ip: remoteIp,
    mac: "",
    identity: "",
    version: "",
    platform: "",
    board: "",
    interface: "",
    ipv4: remoteIp,
    uptimeSeconds: 0,
  };

  while (offset + 4 <= buf.length) {
    const type = buf.readUInt16BE(offset);
    const len = buf.readUInt16BE(offset + 2);
    offset += 4;
    if (offset + len > buf.length) break;
    const valBuf = buf.subarray(offset, offset + len);

    switch (type) {
      case 0x0001: // MAC Address
        result.mac = Array.from(valBuf)
          .map((b) => b.toString(16).padStart(2, "0"))
          .join(":")
          .toUpperCase();
        break;
      case 0x0005: // Identity (hostname)
        result.identity = valBuf.toString("utf8").replace(/\0+$/, "");
        break;
      case 0x0007: // RouterOS Version
        result.version = valBuf.toString("utf8").replace(/\0+$/, "");
        break;
      case 0x0008: // Platform (e.g. MikroTik)
        result.platform = valBuf.toString("utf8").replace(/\0+$/, "");
        break;
      case 0x000a: // Uptime
        if (len === 4) result.uptimeSeconds = valBuf.readUInt32LE(0);
        break;
      case 0x000c: // Board Name (e.g. CHR, RB750Gr3)
        result.board = valBuf.toString("utf8").replace(/\0+$/, "");
        break;
      case 0x0010: // Interface Name (e.g. ether1)
        result.interface = valBuf.toString("utf8").replace(/\0+$/, "");
        break;
      case 0x0011: // IPv4 Address
        if (len === 4) result.ipv4 = Array.from(valBuf).join(".");
        break;
    }
    offset += len;
  }

  // Valid MNDP packet must have at least MAC and Identity
  if (!result.mac || !result.identity) return null;
  return result;
}

/** Quick non-blocking TCP socket check to see if SSH port 22 is reachable. */
export function checkPort(
  host: string,
  port = 22,
  timeoutMs = 800
): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => {
      socket.destroy();
      resolve(false);
    });
    socket.connect(port, host);
  });
}

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
