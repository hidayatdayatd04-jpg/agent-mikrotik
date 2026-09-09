import type { DiscoveredDevice } from "./types";

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
