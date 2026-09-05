import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
  createHmac,
} from "node:crypto";

export interface SealedSecret {
  ciphertext: string;
  nonce: string;
  authTag: string;
  keyVersion: number;
}

export interface KeyRing {
  /** Returns the raw 32-byte key for a key version, or null if unknown. */
  resolve(version: number): Buffer | null;
  currentVersion: number;
}

/**
 * AAD binds ciphertext to its owner: moving a ciphertext between records
 * (different user/connection) fails authentication.
 */
function aadFor(userId: string, connectionId: string): Buffer {
  return createHash("sha256")
    .update(`v1|router-credential|${userId}|${connectionId}`)
    .digest();
}

export function sealSecret(
  keyRing: KeyRing,
  plaintext: string,
  userId: string,
  connectionId: string,
): SealedSecret {
  const version = keyRing.currentVersion;
  const key = keyRing.resolve(version);
  if (!key) throw new Error(`encryption key version ${version} unavailable`);
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce, { authTagLength: 16 });
  cipher.setAAD(aadFor(userId, connectionId));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    ciphertext: ciphertext.toString("base64"),
    nonce: nonce.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    keyVersion: version,
  };
}

export function openSecret(
  keyRing: KeyRing,
  sealed: SealedSecret,
  userId: string,
  connectionId: string,
): string | null {
  const key = keyRing.resolve(sealed.keyVersion);
  if (!key) return null;
  try {
    const nonce = Buffer.from(sealed.nonce, "base64");
    const tag = Buffer.from(sealed.authTag, "base64");
    const data = Buffer.from(sealed.ciphertext, "base64");
    const decipher = createDecipheriv("aes-256-gcm", key, nonce, { authTagLength: 16 });
    decipher.setAAD(aadFor(userId, connectionId));
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(data), decipher.final()]);
    return plaintext.toString("utf8");
  } catch {
    return null;
  }
}

/** HMAC digest with a dedicated secret; used for OTP digests and token hashes. */
export function hmacDigest(secret: string, ...parts: string[]): string {
  return createHmac("sha256", secret).update(parts.join("|")).digest("hex");
}

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function envKeyRing(
  keysByVersion: Record<number, string>,
  currentVersion: number,
): KeyRing {
  const cache = new Map<number, Buffer | null>();
  return {
    get currentVersion() {
      return currentVersion;
    },
    resolve(version: number): Buffer | null {
      if (cache.has(version)) return cache.get(version) ?? null;
      const raw = keysByVersion[version];
      if (!raw) {
        cache.set(version, null);
        return null;
      }
      const key = Buffer.from(raw, "base64");
      if (key.length !== 32) {
        cache.set(version, null);
        return null;
      }
      cache.set(version, key);
      return key;
    },
  };
}
