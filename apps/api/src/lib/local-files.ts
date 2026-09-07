import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";

/** The key belongs to the OS user's data directory, never the package install. */
export function ensureLocalKey(dataDir: string): string {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const path = resolve(dataDir, "credential.key");
  try {
    writeFileSync(path, randomBytes(32).toString("base64"), { flag: "wx", mode: 0o600 });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
  }
  const key = readFileSync(path, "utf8").trim();
  if (Buffer.from(key, "base64").length !== 32) throw new Error("credential.key tidak valid; pulihkan key dari backup.");
  return key;
}
