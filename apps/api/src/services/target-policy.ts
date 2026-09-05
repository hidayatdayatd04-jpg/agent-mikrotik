import { isIP } from "node:net";

export type TargetDecision =
  | { allowed: true; ip: string }
  | { allowed: false; reason: "loopback" | "link-local" | "multicast" | "metadata" | "not-in-allowlist" | "unresolvable" };

const METADATA_HOSTS = new Set([
  "169.254.169.254",
  "100.100.100.200",
  "metadata.google.internal",
  "metadata.goog",
]);

function classifyIp(ip: string): TargetDecision {
  if (ip === "127.0.0.1" || ip === "::1") return { allowed: false, reason: "loopback" };
  if (ip.startsWith("169.254.") || ip.startsWith("fe80:")) return { allowed: false, reason: "link-local" };
  if (ip.startsWith("224.") || ip.startsWith("239.") || ip.startsWith("ff")) return { allowed: false, reason: "multicast" };
  if (METADATA_HOSTS.has(ip)) return { allowed: false, reason: "metadata" };
  return { allowed: true, ip };
}

function ipToLong(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    const v = Number(p);
    if (!Number.isInteger(v) || v < 0 || v > 255) return null;
    n = n * 256 + v;
  }
  return n;
}

export function ipInCidr(ip: string, cidr: string): boolean {
  const [base, bitsRaw] = cidr.split("/");
  const bits = Number(bitsRaw);
  if (!base || !Number.isInteger(bits) || bits < 0 || bits > 32) return false;
  const ipL = ipToLong(ip);
  const baseL = ipToLong(base);
  if (ipL === null || baseL === null) return false;
  if (bits === 0) return true;
  const mask = (0xffffffff << (32 - bits)) >>> 0;
  return ((ipL & mask) >>> 0) === ((baseL & mask) >>> 0);
}

export interface TargetPolicy {
  /**
   * Validates a user-supplied host before any connection attempt:
   * - literal IPs are checked against blocked ranges and the explicit allowlist
   * - hostnames are resolved first (all records must pass policy) to prevent DNS rebinding
   */
  check(host: string): Promise<TargetDecision>;
}

export function createTargetPolicy(allowedCidrs: string[], dnsLookup: (h: string) => Promise<string[]> = defaultLookup): TargetPolicy {
  return {
    async check(host: string): Promise<TargetDecision> {
      const trimmed = host.trim();
      const ipType = isIP(trimmed);
      if (ipType === 4 || ipType === 6) {
        const classified = classifyIp(trimmed);
        if (!classified.allowed) return classified;
        if (allowedCidrs.length === 0) return { allowed: true, ip: trimmed };
        const inList = allowedCidrs.some((cidr) => ipInCidr(trimmed, cidr));
        return inList ? { allowed: true, ip: trimmed } : { allowed: false, reason: "not-in-allowlist" };
      }
      // hostname: reject metadata names outright
      if (METADATA_HOSTS.has(trimmed.toLowerCase())) return { allowed: false, reason: "metadata" };
      let records: string[];
      try {
        records = await dnsLookup(trimmed);
      } catch {
        return { allowed: false, reason: "unresolvable" };
      }
      if (records.length === 0) return { allowed: false, reason: "unresolvable" };
      // EVERY resolved address must pass; a single bad record means rejection.
      for (const r of records) {
        const classified = classifyIp(r);
        if (!classified.allowed) return classified;
        if (allowedCidrs.length > 0 && !allowedCidrs.some((cidr) => ipInCidr(r, cidr))) {
          return { allowed: false, reason: "not-in-allowlist" };
        }
      }
      return { allowed: true, ip: records[0]! };
    },
  };
}

async function defaultLookup(host: string): Promise<string[]> {
  const { lookup } = await import("node:dns/promises");
  const all = await lookup(host, { all: true });
  return all.map((a) => a.address);
}
