import os from "node:os";
import net from "node:net";

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
