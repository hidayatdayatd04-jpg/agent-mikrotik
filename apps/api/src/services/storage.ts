import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile, rename, unlink } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { AppError } from "../lib/errors";

export const UPLOAD_ALLOWED = {
  "image/png": { ext: "png", kind: "image" as const },
  "image/jpeg": { ext: "jpg", kind: "image" as const },
  "image/webp": { ext: "webp", kind: "image" as const },
  "application/pdf": { ext: "pdf", kind: "pdf" as const },
  "text/plain": { ext: "txt", kind: "text" as const },
  "text/csv": { ext: "csv", kind: "text" as const },
  "text/log": { ext: "log", kind: "text" as const },
  "application/octet-stream": { ext: "bin", kind: "text" as const }, // .log/.rsc often arrive as octet-stream; sniffed below
} as const;

const TEXTUAL_EXTENSIONS = new Set(["txt", "csv", "log", "rsc"]);
const MAX_OBJECT_KEY_LEN = 512;
/** Magic-byte sniffing: extension/MIME claims are not trusted. */
export function detectContentKind(input: { mimeType: string; originalName: string; head: Buffer }): { ok: boolean; kind: "image" | "pdf" | "text" | "unsupported"; reason?: string } {
  const name = input.originalName.toLowerCase();
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1) : "";
  const head = input.head;

  if (head.length >= 4 && head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) {
    return input.mimeType === "image/png" ? { ok: true, kind: "image" } : { ok: false, kind: "unsupported", reason: "MIME tidak cocok dengan isi PNG." };
  }
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) {
    return input.mimeType === "image/jpeg" ? { ok: true, kind: "image" } : { ok: false, kind: "unsupported", reason: "MIME tidak cocok dengan isi JPEG." };
  }
  if (head.length >= 12 && head.slice(0, 4).toString("ascii") === "RIFF" && head.slice(8, 12).toString("ascii") === "WEBP") {
    return input.mimeType === "image/webp" ? { ok: true, kind: "image" } : { ok: false, kind: "unsupported", reason: "MIME tidak cocok dengan isi WebP." };
  }
  if (head.length >= 5 && head.slice(0, 5).toString("ascii") === "%PDF-") {
    return input.mimeType === "application/pdf" ? { ok: true, kind: "pdf" } : { ok: false, kind: "unsupported", reason: "MIME tidak cocok dengan isi PDF." };
  }
  if (TEXTUAL_EXTENSIONS.has(ext)) {
    const sample = head.subarray(0, 512);
    let textual = sample.length === 0;
    for (const b of sample) {
      if (b === 9 || b === 10 || b === 13 || (b >= 32 && b < 127) || b >= 128) {
        textual = true;
      } else {
        textual = false;
        break;
      }
    }
    if (!textual) return { ok: false, kind: "unsupported", reason: "File teks berisi byte biner." };
    const expected = input.mimeType === "text/plain" || input.mimeType === "text/csv" || input.mimeType === "text/log" || input.mimeType === "application/octet-stream";
    return expected ? { ok: true, kind: "text" } : { ok: false, kind: "unsupported", reason: `MIME ${input.mimeType} tidak cocok untuk file ${ext}.` };
  }
  return { ok: false, kind: "unsupported", reason: `Tipe file .${ext || "?"} (${input.mimeType}) tidak didukung. Gunakan PNG/JPEG/WebP, PDF, TXT, CSV, LOG, atau RSC.` };
}

/** Local files addressed only by server-generated object keys. */
export function createStorageService(deps: { directory: string }) {
  const root = resolve(deps.directory);
  function pathFor(key: string) {
    if (key.length > MAX_OBJECT_KEY_LEN || !/^attachments\/[a-zA-Z0-9-]+\/[a-zA-Z0-9-]+\/[a-f0-9]{32}\.[a-z0-9]+$/.test(key)) {
      throw new AppError("VALIDATION_FAILED", "Object key lokal tidak valid.", 422);
    }
    return resolve(root, ...key.split("/"));
  }
  function buildObjectKey(userId: string, conversationId: string, ext: string) {
    const key = `attachments/${userId}/${conversationId}/${randomBytes(16).toString("hex")}.${ext || "bin"}`;
    pathFor(key);
    return key;
  }
  async function put(input: { objectKey: string; body: Buffer; contentType: string; contentLength: number }) {
    const target = pathFor(input.objectKey);
    if (input.contentLength !== input.body.length) throw new AppError("VALIDATION_FAILED", "Ukuran file tidak cocok.", 422);
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    const temporary = `${target}.${randomBytes(8).toString("hex")}.tmp`;
    try {
      await writeFile(temporary, input.body, { flag: "wx", mode: 0o600 });
      await rename(temporary, target);
    } finally {
      await unlink(temporary).catch((err: NodeJS.ErrnoException) => { if (err.code !== "ENOENT") throw err; });
    }
    return { checksum: createHash("sha256").update(input.body).digest("hex"), fileId: input.objectKey };
  }
  async function get(objectKey: string): Promise<{ body: Buffer; contentType?: string }> {
    return { body: await readFile(pathFor(objectKey)) };
  }
  async function remove(objectKey: string) {
    await unlink(pathFor(objectKey)).catch((err: NodeJS.ErrnoException) => { if (err.code !== "ENOENT") throw err; });
  }
  return { buildObjectKey, put, get, remove };
}
export type StorageService = ReturnType<typeof createStorageService>;
