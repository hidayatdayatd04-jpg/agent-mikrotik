import { describe, expect, test } from "bun:test";
import {
  sealSecret,
  openSecret,
  envKeyRing,
  makeKeyRing,
  type SealedSecret,
} from "./crypto";

const KEY = Buffer.alloc(32, 7).toString("base64");
const OTHER_KEY = Buffer.alloc(32, 9).toString("base64");

const ring = envKeyRing({ 1: KEY }, 1);
const ring2 = envKeyRing({ 1: KEY, 2: OTHER_KEY }, 2);

describe("sealSecret/openSecret round-trip", () => {
  test("round-trips with same owner binding", () => {
    const sealed = sealSecret(ring, "router-password-123", "user-1", "conn-1");
    expect(sealed.keyVersion).toBe(1);
    const opened = openSecret(ring, sealed, "user-1", "conn-1");
    expect(opened).toBe("router-password-123");
  });

  test("rejects ciphertext moved to another user", () => {
    const sealed = sealSecret(ring, "secret", "user-1", "conn-1");
    expect(openSecret(ring, sealed, "user-2", "conn-1")).toBeNull();
  });

  test("rejects ciphertext moved to another connection", () => {
    const sealed = sealSecret(ring, "secret", "user-1", "conn-1");
    expect(openSecret(ring, sealed, "user-1", "conn-2")).toBeNull();
  });

  test("rejects tampered ciphertext", () => {
    const sealed = sealSecret(ring, "secret", "user-1", "conn-1");
    const bytes = Buffer.from(sealed.ciphertext, "base64");
    bytes[0]! ^= 0xff;
    const tampered: SealedSecret = { ...sealed, ciphertext: bytes.toString("base64") };
    expect(openSecret(ring, tampered, "user-1", "conn-1")).toBeNull();
  });

  test("rejects wrong key", () => {
    const sealed = sealSecret(ring, "secret", "user-1", "conn-1");
    const wrongRing = envKeyRing({ 1: OTHER_KEY }, 1);
    expect(openSecret(wrongRing, sealed, "user-1", "conn-1")).toBeNull();
  });

  test("old key version still decryptable after rotation (v1 data under ring with v1+v2)", () => {
    const sealedV1 = sealSecret(ring, "old-secret", "user-1", "conn-1");
    expect(sealedV1.keyVersion).toBe(1);
    expect(openSecret(ring2, sealedV1, "user-1", "conn-1")).toBe("old-secret");
    const sealedV2 = sealSecret(ring2, "new-secret", "user-1", "conn-1");
    expect(sealedV2.keyVersion).toBe(2);
  });

  test("makeKeyRing wires PREVIOUS key into multi-version ring (rotasi env)", () => {
    const silent = { warn: () => {} };
    const ring = makeKeyRing(KEY, 2, OTHER_KEY, 1, false, silent);
    // seal with old ring (v1) then open with rotated ring (v1+v2)
    const oldRing = envKeyRing({ 1: OTHER_KEY }, 1);
    const sealedV1 = sealSecret(oldRing, "rotasi", "u", "c");
    expect(openSecret(ring, sealedV1, "u", "c")).toBe("rotasi");
    // new seals use v2
    const sealedV2 = sealSecret(ring, "baru", "u", "c");
    expect(sealedV2.keyVersion).toBe(2);
    // production without key throws
    expect(() => makeKeyRing(undefined, 1, undefined, undefined, true, silent)).toThrow();
  });

  test("missing key version returns null, not throw", () => {
    const sealed = sealSecret(ring, "secret", "user-1", "conn-1");
    const noKeyRing = envKeyRing({}, 1);
    expect(openSecret(noKeyRing, sealed, "user-1", "conn-1")).toBeNull();
  });
});
