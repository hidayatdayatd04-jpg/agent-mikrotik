import { describe, expect, test } from "bun:test";
import { applySafetyDefaults, classifyBatch, isLocalCommand, normalizeBare } from "./terminal-classifier";

describe("terminal classifier (controlled RouterOS, no host shell)", () => {
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
