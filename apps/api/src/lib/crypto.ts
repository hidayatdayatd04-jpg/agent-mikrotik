import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
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

/**
 * Build a KeyRing from env config. Supports key rotation: the current
 * key seals new secrets at `version`; `previousKey` (older version) stays
 * resolvable so existing records decrypt until re-sealed.
 */
export function makeKeyRing(
  key: string | undefined,
  version: number,
  previousKey: string | undefined,
  previousVersion: number | undefined,
  isProduction: boolean,
  log: { warn: (msg: string, data?: unknown) => void },
): KeyRing {
  if (key) {
    const keysByVersion: Record<number, string> = { [version]: key };
    if (previousKey && previousVersion && previousVersion < version) {
      keysByVersion[previousVersion] = previousKey;
    }
    return envKeyRing(keysByVersion, version);
  }
  if (isProduction) {
    throw new Error("ROUTER_CREDENTIAL_KEY wajib di isi di production (base64 32 byte).");
  }
  log.warn("ROUTER_CREDENTIAL_KEY tidak diisi — memakai dev-key. Jangan pakai di production.");
  const devKey = Buffer.from("dev-only-credential-key-32bytes-padx", "utf8").subarray(0, 32).toString("base64");
  return envKeyRing({ [version]: devKey }, version);
}
