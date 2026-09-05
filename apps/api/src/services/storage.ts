import { createHash, randomBytes } from "node:crypto";
import type { Logger } from "../lib/logger";
import { AppError } from "../lib/errors";

/**
 * Private object storage on Backblaze B2 via the NATIVE B2 API (M8).
 *
 * Why not the S3-compatible API: the Master Application Key id used by this
 * deployment (12-hex-char keyId) is rejected by AWS SigV4 parsers with
 * "Malformed Access Key Id", while the same key authenticates fine against
 * the native B2 JSON API (verified end-to-end in M6 and again while writing
 * M8 — docs/decisions.md D-010/D-012). All objects live in one private
 * bucket; the browser never receives B2 credentials or presigned URLs — the
 * backend streams uploads/downloads and enforces ownership via the
 * attachments table before touching the object.
 */

export interface StorageConfig {
  keyId: string;
  applicationKey: string;
  bucket: string;
  region: string;
  endpoint: string;
}

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
const AUTH_TTL_MS = 60 * 60 * 1000; // re-authorize hourly

interface B2Auth {
  token: string;
  apiUrl: string;
  downloadUrl: string;
  accountId: string;
  bucketId: string | null;
  expiresAt: number;
}

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

export function createStorageService(deps: { config: StorageConfig; logger: Logger }) {
  let auth: B2Auth | null = null;
  let authorizePromise: Promise<B2Auth> | null = null;

  async function authorize(force = false): Promise<B2Auth> {
    if (!force && auth && auth.expiresAt > Date.now()) return auth;
    if (authorizePromise) return authorizePromise;
    authorizePromise = (async () => {
      const basic = Buffer.from(`${deps.config.keyId}:${deps.config.applicationKey}`).toString("base64");
      const res = await fetch("https://api.backblazeb2.com/b2api/v3/b2_authorize_account", {
        headers: { Authorization: `Basic ${basic}` },
      });
      if (!res.ok) {
        deps.logger.warn("b2 authorize failed", { status: res.status });
        throw new AppError("STORAGE_UNAVAILABLE", "Autentikasi penyimpanan B2 gagal.", 502);
      }
      const j = (await res.json()) as {
        authorizationToken?: string;
        accountId?: string;
        apiInfo?: { storageApi?: { apiUrl?: string; downloadUrl?: string; bucketId?: string | null } };
      };
      const api = j.apiInfo?.storageApi;
      if (!j.authorizationToken || !api?.apiUrl || !api?.downloadUrl) {
        throw new AppError("STORAGE_UNAVAILABLE", "Respons B2 tidak lengkap.", 502);
      }
      const fresh: B2Auth = {
        token: j.authorizationToken,
        apiUrl: api.apiUrl,
        downloadUrl: api.downloadUrl,
        accountId: j.accountId ?? "",
        bucketId: api.bucketId ?? null,
        expiresAt: Date.now() + AUTH_TTL_MS,
      };
      auth = fresh;
      return fresh;
    })();
    try {
      return await authorizePromise;
    } finally {
      authorizePromise = null;
    }
  }

  async function requireBucketId(): Promise<{ a: B2Auth; bucketId: string }> {
    const a = await authorize();
    if (a.bucketId) return { a, bucketId: a.bucketId };
    // key scoped to one bucket: look the id up once
    const res = await fetch(`${a.apiUrl}/b2api/v3/b2_list_buckets`, {
      method: "POST",
      headers: { Authorization: a.token, "Content-Type": "application/json" },
      body: JSON.stringify({ accountId: a.accountId }),
    });
    if (!res.ok) throw new AppError("STORAGE_UNAVAILABLE", "Gagal membaca daftar bucket B2.", 502);
    const j = (await res.json()) as { buckets?: { bucketId: string; bucketName: string }[] };
    const hit = j.buckets?.find((b) => b.bucketName === deps.config.bucket);
    if (!hit) throw new AppError("STORAGE_UNAVAILABLE", `Bucket ${deps.config.bucket} tidak ditemukan.`, 502);
    a.bucketId = hit.bucketId;
    return { a, bucketId: hit.bucketId };
  }

  /** Server-owned object key: attachments/{userId}/{conversationId}/{random}.ext */
  function buildObjectKey(userId: string, conversationId: string, ext: string): string {
    const rand = randomBytes(16).toString("hex");
    const key = `attachments/${userId}/${conversationId}/${rand}.${ext || "bin"}`;
    if (key.length > MAX_OBJECT_KEY_LEN) throw new AppError("VALIDATION_FAILED", "Object key terlalu panjang.", 422);
    return key;
  }

  async function put(input: { objectKey: string; body: Buffer; contentType: string; contentLength: number }): Promise<{ checksum: string; fileId: string }> {
    try {
      const { a, bucketId } = await requireBucketId();
      const up = await fetch(`${a.apiUrl}/b2api/v3/b2_get_upload_url`, {
        method: "POST",
        headers: { Authorization: a.token, "Content-Type": "application/json" },
        body: JSON.stringify({ bucketId }),
      });
      if (!up.ok) {
        const txt = await up.text().catch(() => "");
        deps.logger.warn("b2 get_upload_url failed", { status: up.status, body: txt.slice(0, 200) });
        throw new AppError("STORAGE_UNAVAILABLE", "Gagal mendapatkan URL unggah B2.", 502);
      }
      const uj = (await up.json()) as { uploadUrl?: string; authorizationToken?: string };
      if (!uj.uploadUrl || !uj.authorizationToken) throw new AppError("STORAGE_UNAVAILABLE", "Respons upload URL B2 tidak lengkap.", 502);
      const sha1 = createHash("sha1").update(input.body).digest("hex");
      const res = await fetch(uj.uploadUrl, {
        method: "POST",
        headers: {
          Authorization: uj.authorizationToken,
          "X-Bz-File-Name": encodeURIComponent(input.objectKey),
          "Content-Type": input.contentType,
          "Content-Length": String(input.contentLength),
          "X-Bz-Content-Sha1": sha1,
        },
        body: new Uint8Array(input.body),
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        deps.logger.warn("b2 put failed", { key: input.objectKey, status: res.status, body: txt.slice(0, 200) });
        throw new AppError("STORAGE_UNAVAILABLE", "Gagal menyimpan file ke penyimpanan objek.", 502);
      }
      const pj = (await res.json()) as { fileId?: string };
      return { checksum: sha1, fileId: pj.fileId ?? "" };
    } catch (err) {
      if (err instanceof AppError) throw err;
      deps.logger.warn("b2 put failed", { key: input.objectKey, error: err instanceof Error ? err.message : String(err) });
      throw new AppError("STORAGE_UNAVAILABLE", "Gagal menyimpan file ke penyimpanan objek.", 502);
    }
  }

  /** Download via the bucket's private download endpoint with the auth token. */
  async function get(objectKey: string): Promise<{ body: Buffer; contentType?: string }> {
    try {
      const a = await authorize();
      const res = await fetch(`${a.downloadUrl}/file/${deps.config.bucket}/${objectKey}`, {
        headers: { Authorization: a.token },
      });
      if (!res.ok) {
        deps.logger.warn("b2 get failed", { key: objectKey, status: res.status });
        throw new AppError("STORAGE_UNAVAILABLE", "Gagal membaca file dari penyimpanan objek.", 502);
      }
      const buf = Buffer.from(await res.arrayBuffer());
      return { body: buf, contentType: res.headers.get("content-type") ?? undefined };
    } catch (err) {
      if (err instanceof AppError) throw err;
      deps.logger.warn("b2 get failed", { key: objectKey, error: err instanceof Error ? err.message : String(err) });
      throw new AppError("STORAGE_UNAVAILABLE", "Gagal membaca file dari penyimpanan objek.", 502);
    }
  }

  async function remove(objectKey: string): Promise<void> {
    try {
      const a = await authorize();
      // find file id by name (hide_versions: latest only)
      const list = await fetch(`${a.apiUrl}/b2api/v3/b2_list_file_names`, {
        method: "POST",
        headers: { Authorization: a.token, "Content-Type": "application/json" },
        body: JSON.stringify({ bucketId: (await requireBucketId()).bucketId, startFileName: objectKey, maxFileCount: 1 }),
      });
      if (!list.ok) throw new Error(`list ${list.status}`);
      const lj = (await list.json()) as { files?: { fileName: string; fileId: string }[] };
      const hit = lj.files?.find((f) => f.fileName === objectKey);
      if (!hit) return; // already gone
      const del = await fetch(`${a.apiUrl}/b2api/v3/b2_delete_file_version`, {
        method: "POST",
        headers: { Authorization: a.token, "Content-Type": "application/json" },
        body: JSON.stringify({ fileName: hit.fileName, fileId: hit.fileId }),
      });
      if (!del.ok) throw new Error(`delete ${del.status}`);
    } catch (err) {
      // deletion failure is logged but non-fatal: orphans are re-swept later
      deps.logger.warn("b2 delete failed (orphan possible)", { key: objectKey, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return { buildObjectKey, put, get, remove };
}

export type StorageService = ReturnType<typeof createStorageService>;
