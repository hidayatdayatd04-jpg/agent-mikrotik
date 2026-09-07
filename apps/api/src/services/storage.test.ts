import { describe, expect, test } from "bun:test";
import { detectContentKind } from "./storage";

/** Magic-byte sniffing tests — MIME/extension claims are never trusted. */

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
const WEBP = Buffer.concat([Buffer.from("RIFF", "ascii"), Buffer.alloc(4), Buffer.from("WEBP", "ascii")]);
const PDF = Buffer.from("%PDF-1.7\n...", "ascii");
const TEXT = Buffer.from("# RouterOS config\n/interface ethernet\n", "ascii");

describe("detectContentKind", () => {
  test("PNG signature + image/png → image", () => {
    expect(detectContentKind({ mimeType: "image/png", originalName: "diagram.png", head: PNG })).toEqual({ ok: true, kind: "image" });
  });

  test("JPEG bytes with lying text/plain MIME → rejected", () => {
    const out = detectContentKind({ mimeType: "text/plain", originalName: "foto.jpg", head: JPEG });
    expect(out.ok).toBe(false);
    expect(out.reason).toContain("JPEG");
  });

  test("WebP + image/webp → image", () => {
    expect(detectContentKind({ mimeType: "image/webp", originalName: "shot.webp", head: WEBP })).toEqual({ ok: true, kind: "image" });
  });

  test("PDF signature + application/pdf → pdf", () => {
    expect(detectContentKind({ mimeType: "application/pdf", originalName: "manual.pdf", head: PDF })).toEqual({ ok: true, kind: "pdf" });
  });

  test("TXT with clean ASCII → text", () => {
    expect(detectContentKind({ mimeType: "text/plain", originalName: "notes.txt", head: TEXT })).toEqual({ ok: true, kind: "text" });
  });

  test("RSC arriving as application/octet-stream → text (common router export case)", () => {
    expect(detectContentKind({ mimeType: "application/octet-stream", originalName: "export.rsc", head: TEXT })).toEqual({ ok: true, kind: "text" });
  });

  test("LOG with text/log → text", () => {
    expect(detectContentKind({ mimeType: "text/log", originalName: "router.log", head: TEXT })).toEqual({ ok: true, kind: "text" });
  });

  test("CSV via text/plain with .csv name → text", () => {
    expect(detectContentKind({ mimeType: "text/plain", originalName: "data.csv", head: TEXT })).toEqual({ ok: true, kind: "text" });
  });

  test("binary bytes inside a .txt → rejected as binary", () => {
    const out = detectContentKind({ mimeType: "text/plain", originalName: "blob.txt", head: Buffer.from([0x00, 0x01, 0x02, 0x03]) });
    expect(out.ok).toBe(false);
    expect(out.reason).toContain("biner");
  });

  test("HTML extension is refused regardless of bytes", () => {
    const out = detectContentKind({ mimeType: "text/html", originalName: "page.html", head: TEXT });
    expect(out.ok).toBe(false);
    expect(out.kind).toBe("unsupported");
  });

  test("SVG is refused even when MIME image/svg+xml is absent", () => {
    const out = detectContentKind({ mimeType: "text/plain", originalName: "icon.svg", head: TEXT });
    expect(out.ok).toBe(false);
  });

  test("archive zip is refused", () => {
    const out = detectContentKind({ mimeType: "application/zip", originalName: "backup.zip", head: Buffer.from("PK\x03\x04", "ascii") });
    expect(out.ok).toBe(false);
  });

  test("empty text file head passes as text", () => {
    expect(detectContentKind({ mimeType: "text/plain", originalName: "empty.txt", head: Buffer.alloc(0) })).toEqual({ ok: true, kind: "text" });
  });
});
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStorageService } from "./storage";

test("local attachments persist and reject traversal; deletion is idempotent", async () => {
  const folder = mkdtempSync(join(tmpdir(), "mikrotik-files-test-"));
  try {
    const storage = createStorageService({ directory: folder });
    const key = storage.buildObjectKey("local", "conversation", "rsc");
    const body = Buffer.from("/system identity print");
    await storage.put({ objectKey: key, body, contentType: "text/plain", contentLength: body.length });
    const reopened = createStorageService({ directory: folder });
    expect((await reopened.get(key)).body).toEqual(body);
    for (const key of ["../secret", "C:/secret", "attachments/local/../secret", "attachments\\local\\secret"]) {
      await expect(reopened.get(key)).rejects.toThrow("Object key");
    }
    await reopened.remove(key);
    await reopened.remove(key);
    await expect(reopened.get(key)).rejects.toThrow();
  } finally { rmSync(folder, { recursive: true, force: true }); }
});
