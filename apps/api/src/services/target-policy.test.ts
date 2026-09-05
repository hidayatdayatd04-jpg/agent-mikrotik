import { describe, expect, test } from "bun:test";
import { createTargetPolicy, ipInCidr, type TargetDecision } from "./target-policy";

const noDns = async () => {
  throw new Error("no dns");
};
const staticDns = (map: Record<string, string[]>) => async (h: string) => map[h] ?? [];

function denyReason(d: TargetDecision): string {
  if (d.allowed) throw new Error(`expected denial, got ${JSON.stringify(d)}`);
  return d.reason;
}

describe("ipInCidr", () => {
  test("basic CIDR membership", () => {
    expect(ipInCidr("192.168.1.10", "192.168.0.0/16")).toBe(true);
    expect(ipInCidr("192.169.1.10", "192.168.0.0/16")).toBe(false);
    expect(ipInCidr("10.0.0.1", "10.0.0.0/8")).toBe(true);
    expect(ipInCidr("11.0.0.1", "10.0.0.0/8")).toBe(false);
    expect(ipInCidr("1.2.3.4", "0.0.0.0/0")).toBe(true);
    expect(ipInCidr("192.168.1.1", "192.168.1.1/32")).toBe(true);
    expect(ipInCidr("192.168.1.2", "192.168.1.1/32")).toBe(false);
  });
});

describe("target policy (no DNS)", () => {
  const policy = createTargetPolicy([], noDns);

  test("allows private router IPs when no allowlist configured", async () => {
    expect(await policy.check("192.168.88.1")).toEqual({ allowed: true, ip: "192.168.88.1" });
    expect(await policy.check("10.10.0.1")).toEqual({ allowed: true, ip: "10.10.0.1" });
  });

  test("blocks loopback/link-local/multicast/metadata", async () => {
    expect(denyReason(await policy.check("127.0.0.1"))).toBe("loopback");
    expect(denyReason(await policy.check("::1"))).toBe("loopback");
    expect(denyReason(await policy.check("169.254.169.254"))).toBe("link-local");
    expect(denyReason(await policy.check("224.0.0.1"))).toBe("multicast");
    expect(denyReason(await policy.check("metadata.google.internal"))).toBe("metadata");
  });

  test("unresolvable host rejected", async () => {
    expect(denyReason(await policy.check("router.local.test"))).toBe("unresolvable");
  });
});

describe("target policy (with allowlist + DNS)", () => {
  const policy = createTargetPolicy(["192.168.0.0/16"], staticDns({
    "router.lan": ["192.168.88.5"],
    "rebind.evil": ["192.168.1.1", "169.254.169.254"],
    "outside.lan": ["8.8.8.8"],
    "unresolvable.x": [],
  }));

  test("hostname resolving into allowlist passes", async () => {
    expect(await policy.check("router.lan")).toEqual({ allowed: true, ip: "192.168.88.5" });
  });

  test("DNS rebinding: one bad record rejects the host", async () => {
    expect(denyReason(await policy.check("rebind.evil"))).toBe("link-local");
  });

  test("hostname resolving outside allowlist rejected", async () => {
    expect(denyReason(await policy.check("outside.lan"))).toBe("not-in-allowlist");
  });

  test("literal IP outside allowlist rejected", async () => {
    expect(denyReason(await policy.check("172.16.0.1"))).toBe("not-in-allowlist");
  });

  test("empty DNS answer rejected", async () => {
    expect(denyReason(await policy.check("unresolvable.x"))).toBe("unresolvable");
  });
});
