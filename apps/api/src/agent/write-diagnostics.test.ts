import { describe, expect, test } from "bun:test";
import { diagnoseWriteBlock } from "./write-diagnostics";

describe("diagnoseWriteBlock certainty discipline", () => {
  test("read-only adds no note (main instruction already guides)", () => {
    const d = diagnoseWriteBlock({ mode: "read-only", connected: true, hasIdentity: true, emptyCredential: null, beginError: null });
    expect(d.cause).toBe("read-only-mode");
    expect(d.note).toBe("");
  });

  test("disconnected router is certain with reconnect steps", () => {
    const d = diagnoseWriteBlock({ mode: "write", connected: false, hasIdentity: false, emptyCredential: null, beginError: null });
    expect(d.certainty).toBe("certain");
    expect(d.cause).toBe("router-disconnected");
    expect(d.note).toContain("menyambungkan");
  });

  test("empty stored credential is certain and names the password fix", () => {
    const d = diagnoseWriteBlock({ mode: "write", connected: true, hasIdentity: true, emptyCredential: true, beginError: null });
    expect(d.certainty).toBe("certain");
    expect(d.cause).toBe("empty-credential");
    expect(d.note).toContain("password admin");
    expect(d.note).toContain("keyakinan: pasti");
  });

  test("password-change output is certain even without the credential check", () => {
    const d = diagnoseWriteBlock({
      mode: "write", connected: true, hasIdentity: true, emptyCredential: null,
      beginError: "Safe Mode tidak dapat dibuka: Change your password (Ctrl-C to skip)",
    });
    expect(d.certainty).toBe("certain");
    expect(d.note).toContain("password admin");
  });

  test("busy router is certain and tells the user to wait", () => {
    const d = diagnoseWriteBlock({
      mode: "write", connected: true, hasIdentity: true, emptyCredential: false,
      beginError: "Safe Mode router ini sedang dipakai transaksi lain. Tunggu hingga selesai.",
    });
    expect(d.certainty).toBe("certain");
    expect(d.cause).toBe("transaction-busy");
  });

  test("shell-prompt timeout is only likely, ranked, never asserted", () => {
    const d = diagnoseWriteBlock({
      mode: "write", connected: true, hasIdentity: true, emptyCredential: false,
      beginError: "Safe Mode tidak dapat dibuka: Timed out waiting for MikroTik shell prompt. Got: ...",
    });
    expect(d.certainty).toBe("likely");
    expect(d.cause).toBe("prompt-unreachable");
    expect(d.note).toContain("keyakinan: kemungkinan");
    expect(d.note).toContain("Timed out waiting for MikroTik shell prompt");
    // must not assert the password cause when the credential is known non-empty
    expect(d.note).not.toContain("kredensial connector yang tersimpan kosong");
  });

  test("unrecognized error stays unknown and quotes the message", () => {
    const d = diagnoseWriteBlock({
      mode: "write", connected: true, hasIdentity: true, emptyCredential: null,
      beginError: "gleblorp unexpected 123",
    });
    expect(d.certainty).toBe("unknown");
    expect(d.note).toContain("gleblorp unexpected 123");
    expect(d.note).toContain("keyakinan: belum diketahui");
  });

  test("every non-empty note forbids toggle-sync speculation", () => {
    const cases = [
      { mode: "write" as const, connected: false, hasIdentity: false, emptyCredential: null, beginError: null },
      { mode: "write" as const, connected: true, hasIdentity: true, emptyCredential: true, beginError: null },
      { mode: "write" as const, connected: true, hasIdentity: true, emptyCredential: false, beginError: "Timed out waiting for MikroTik shell prompt" },
    ];
    for (const ev of cases) {
      const d = diagnoseWriteBlock({ ...ev, beginError: ev.beginError ?? null });
      expect(d.note.length).toBeGreaterThan(0);
      expect(d.note).toContain("satu-satunya sumber kebenaran");
    }
  });
});
