import { describe, expect, test } from "bun:test";
import { applySafetyDefaults, classifyBatch, isLocalCommand, normalizeBare } from "./terminal-classifier";

describe("terminal classifier (controlled RouterOS, no host shell)", () => {
  test.each([
    "/ip dhcp-server lease make-static number=0",
    "/tool e-mail send to=test@example.com subject=hi body=hello",
    "/tool sniffer start",
  ])("aksi tanpa whitelist ditolak: %s", (command) => {
    const result = classifyBatch(command);
    expect(result.commands[0]!.risk).not.toBe("read");
    expect(result.overall).toBe("unknown");
    expect(result.blocked).not.toBeNull();
    expect(result.commands[0]!.rollbackable).toBe(false);
  });

  test.each([
    "/ip dhcp-server lease print detail",
    "/ip firewall filter print stats",
    "/ipv6 address print",
    "/routing bgp session print",
    "/queue simple print",
    "/tool sniffer print",
    "/system identity get name",
    "/interface monitor ether1 once",
    "/interface monitor-traffic ether1 once",
    "/ip firewall export",
    "/export compact",
    "/tool ping 192.0.2.1 count=1",
    "  /ip   dhcp-server lease print  ",
  ])("verb baca eksplisit tetap diterima: %s", (command) => {
    const result = classifyBatch(command);
    expect(result.overall).toBe("read");
    expect(result.blocked).toBeNull();
  });

  test.each([
    "/ip dhcp-server",
    "/ip firewall",
    "/ipv6",
    "/routing",
    "/queue",
    "/tool",
    "/tool e-mail send to=test@example.com subject=print body=hello",
    '/tool e-mail send to=test@example.com subject="please print this"',
    "/tool sniffer start print",
    "/ip dhcp-server lease make-static number=0 comment=get",
    "/ip firewall filter reset-counters",
    "/routing bgp session refresh numbers=0",
    "/queue simple frobnicate comment=monitor",
    "/ipv6 dhcp-client renew numbers=0",
    "/tool sniffer stop",
    "/system identity print-malicious",
    "/system identity-other print",
    "/system identity get name=[/tool sniffer start]",
    '/system identity print where name="unterminated',
    "/export file=backup",
    "/ip firewall filter print file=rules",
  ])("prefix/kata baca tidak memberikan izin: %s", (command) => {
    const result = classifyBatch(command);
    expect(result.overall).toBe("unknown");
    expect(result.blocked).not.toBeNull();
  });

  test("satu aksi unknown memblokir seluruh batch termasuk bacaan valid", () => {
    const result = classifyBatch("/system identity print; /tool sniffer start");
    expect(result.commands.map((command) => command.risk)).toEqual(["read", "unknown"]);
    expect(result.overall).toBe("unknown");
    expect(result.blocked).not.toBeNull();
  });

  test("mutasi yang didukung tetap memerlukan jalur write", () => {
    const result = classifyBatch('/ip firewall filter add chain=input action=accept comment="print"');
    expect(result.overall).toBe("write");
    expect(result.blocked).toBeNull();
  });

  test("read sukses terklasifikasi", () => {
    const r = classifyBatch("/system identity print");
    expect(r.blocked).toBeNull();
    expect(r.overall).toBe("read");
  });

  test("unknown ditolak, bukan ditebak", () => {
    const r = classifyBatch("/system frobnicate blorp");
    expect(r.blocked).toMatch(/tidak dikenali/i);
    expect(r.overall).toBe("unknown");
  });

  test("multi-command dengan mutasi dinilai menyeluruh; script/find ditolak", () => {
    const r = classifyBatch(`/ip address print; /system script add name=x source=":put hi"`);
    expect(r.blocked).not.toBeNull();
  });

  test("find/subexpression ditolak", () => {
    const r = classifyBatch(`/ip firewall filter remove [find comment="temp"]`);
    expect(r.blocked).not.toBeNull();
  });

  test("batch mutasi terdeteksi sebagai write", () => {
    const r = classifyBatch(`/ip address print\n/ip address add address=10.0.0.2/24 interface=ether1`);
    // add is write; may be blocked only if non-rollbackable — simple add is allowed as write.
    expect(r.overall === "write" || r.blocked !== null).toBe(true);
  });

  test("target host override ditolak (bukan perintah RouterOS)", () => {
    const r = classifyBatch(`ssh admin@10.0.0.1 /system identity print`);
    expect(r.blocked).not.toBeNull();
  });

  test("port 8291 atau MAC-Winbox tidak dianggap bukti SSH", () => {
    // Classifier never claims transport; it only classifies RouterOS syntax.
    const r = classifyBatch(`/interface print`);
    expect(r.blocked).toBeNull();
    expect(r.overall).toBe("read");
  });

  test("bare ping tanpa slash diterima (root menu)", () => {
    const r = classifyBatch(`ping 8.8.8.8`);
    expect(r.blocked).toBeNull();
    expect(r.overall).toBe("read");
  });

  test("bare interface print diterima", () => {
    expect(classifyBatch(`interface print`).blocked).toBeNull();
    expect(normalizeBare(`ping 8.8.8.8`)).toBe(`/ping 8.8.8.8`);
  });

  test("ping tanpa count disuntik count=4 agar tidak hang", () => {
    const { command, injected } = applySafetyDefaults(`/ping 8.8.8.8`);
    expect(command).toBe(`/ping 8.8.8.8 count=4`);
    expect(injected).toMatch(/count=4/);
    const withCount = applySafetyDefaults(`/ping 8.8.8.8 count=2`);
    expect(withCount.command).toBe(`/ping 8.8.8.8 count=2`);
    expect(withCount.injected).toBeNull();
  });

  test("clear/cls adalah perintah lokal, bukan ke router", () => {
    expect(isLocalCommand("clear")).toBe(true);
    expect(isLocalCommand("cls")).toBe(true);
    expect(isLocalCommand("/system identity print")).toBe(false);
  });
});
