import { afterEach, describe, expect, test, vi } from "vitest";
import { apiFetch, apiForm, ApiError, apiErrorTitle } from "./api";

afterEach(() => vi.unstubAllGlobals());

describe("API response errors", () => {
  test.each(["", "Internal Server Error", "<html>Bad Gateway</html>"])("500 with empty/non-JSON body (%s) reports backend unavailable", async (body) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body, { status: 500 })));
    await expect(apiFetch("/api/test")).rejects.toMatchObject({
      code: "BACKEND_UNAVAILABLE", status: 500,
      message: "Backend API (port 3001) tidak aktif atau baru restart. Tunggu sebentar lalu coba lagi.",
    });
  });

  test("502 BACKEND_UNAVAILABLE reports backend recovery instructions", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: { code: "BACKEND_UNAVAILABLE", message: "proxy error" } }, { status: 502 })));
    await expect(apiFetch("/api/test")).rejects.toMatchObject({ code: "BACKEND_UNAVAILABLE", status: 502, message: expect.stringContaining("baru restart") });
  });

  test.each([500, 502, 503, 504])("%i JSON API error preserves server code and message", async (status) => {
    const message = "Terjadi kesalahan internal pada server.";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: { code: "INTERNAL_ERROR", message } }, { status })));
    await expect(apiFetch("/api/test")).rejects.toMatchObject({ code: "INTERNAL_ERROR", status, message });
  });

  test("provider rate-limit and authentication messages survive gateway status", async () => {
    for (const [code, message] of [["UPSTREAM_ERROR", "Kuota provider habis (429 / rate limit)."], ["UPSTREAM_AUTH_FAILED", "Periksa API Key provider."]]) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: { code, message } }, { status: 502 })));
      await expect(apiFetch("/api/test")).rejects.toMatchObject({ code, message, status: 502 });
    }
  });

  test("uploads use the same backend-unavailable handling", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 503 })));
    await expect(apiForm("/api/files", new FormData())).rejects.toMatchObject({ code: "BACKEND_UNAVAILABLE", status: 503 });
  });

  test("alert titles show the actual status/code and omit fictitious status for unknown errors", () => {
    expect(apiErrorTitle(new ApiError("RATE_LIMITED", "wait", 429))).toBe("Gagal Mengirim Pesan (Status 429 / RATE_LIMITED)");
    expect(apiErrorTitle(new ApiError("NETWORK_ERROR", "offline", 0))).toBe("Gagal Mengirim Pesan (NETWORK_ERROR)");
    expect(apiErrorTitle(new Error("unknown"))).toBe("Gagal Mengirim Pesan");
  });
});
