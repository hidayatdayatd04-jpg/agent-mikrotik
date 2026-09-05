import { describe, expect, test, afterEach } from "bun:test";
import { fetchProviderModels } from "./model-fetch";
import { AppError } from "../lib/errors";

/**
 * Unit tests for auto-fetch model list. The global fetch is stubbed so no
 * real provider is contacted; error paths stay typed (UPSTREAM_*).
 */

const silentLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => silentLogger,
} as unknown as Parameters<typeof fetchProviderModels>[0]["logger"];

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function stubFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  globalThis.fetch = ((input: unknown, init?: RequestInit) =>
    handler(String(input), (init ?? {}) as RequestInit)) as typeof fetch;
}

describe("fetchProviderModels", () => {
  test("gemini default base URL uses native /v1beta/models with x-goog-api-key", async () => {
    let seenUrl = "";
    let seenHeader = "";
    stubFetch((url, init) => {
      seenUrl = url;
      seenHeader = String((init.headers as Record<string, string>)["x-goog-api-key"] ?? "");
      return Response.json({
        models: [
          { name: "models/gemini-2.0-flash", displayName: "Gemini 2.0 Flash", supportedGenerationMethods: ["generateContent", "countTokens"] },
          { name: "models/text-embedding-004", supportedGenerationMethods: ["embedContent"] },
          { name: "models/gemini-1.5-pro", displayName: "Gemini 1.5 Pro", supportedGenerationMethods: ["generateContent"] },
        ],
      });
    });
    const out = await fetchProviderModels({ kind: "gemini", apiKey: "test-key-123", logger: silentLogger });
    expect(seenUrl.startsWith("https://generativelanguage.googleapis.com/v1beta/models")).toBe(true);
    expect(seenHeader).toBe("test-key-123");
    expect(out.source).toBe("gemini:/v1beta/models");
    expect(out.models.map((m) => m.id)).toEqual(["gemini-2.0-flash", "gemini-1.5-pro"]);
    expect(out.models[0]?.label).toBe("Gemini 2.0 Flash");
  });

  test("openrouter / custom uses OpenAI-compatible {base}/models with Bearer", async () => {
    let seenUrl = "";
    let seenAuth = "";
    stubFetch((url, init) => {
      seenUrl = url;
      seenAuth = String((init.headers as Record<string, string>).Authorization ?? "");
      return Response.json({
        data: [
          { id: "google/gemini-2.0-flash-001", name: "Google Gemini 2.0 Flash" },
          { id: "openai/gpt-4o-mini", name: "" },
          { name: "no-id-model" },
        ],
      });
    });
    const out = await fetchProviderModels({ kind: "openrouter", apiKey: "sk-or-123", logger: silentLogger });
    expect(seenUrl).toBe("https://openrouter.ai/api/v1/models");
    expect(seenAuth).toBe("Bearer sk-or-123");
    expect(out.models.map((m) => ({ id: m.id, label: m.label ?? "" }))).toEqual([
      { id: "google/gemini-2.0-flash-001", label: "Google Gemini 2.0 Flash" },
      { id: "openai/gpt-4o-mini", label: "" },
    ]);
  });

  test("custom base URL with trailing slash is normalized", async () => {
    let seenUrl = "";
    stubFetch((url) => {
      seenUrl = url;
      return Response.json({ data: [{ id: "m-1" }] });
    });
    const out = await fetchProviderModels({ kind: "custom", baseUrl: "http://localhost:3999/v1/", apiKey: "k", logger: silentLogger });
    expect(seenUrl).toBe("http://localhost:3999/v1/models");
    expect(out.models).toEqual([{ id: "m-1", label: undefined }]);
  });

  test("401 from provider maps to UPSTREAM_AUTH_FAILED", async () => {
    stubFetch(() => new Response("unauthorized", { status: 401 }));
    try {
      await fetchProviderModels({ kind: "custom", baseUrl: "http://localhost:3999/v1", apiKey: "bad", logger: silentLogger });
      throw new Error("should have thrown");
    } catch (err) {
      expect(err instanceof AppError).toBe(true);
      expect((err as AppError).code).toBe("UPSTREAM_AUTH_FAILED");
    }
  });

  test("500 from provider maps to UPSTREAM_ERROR with status in message", async () => {
    stubFetch(() => new Response("boom", { status: 500 }));
    try {
      await fetchProviderModels({ kind: "openrouter", apiKey: "k", logger: silentLogger });
      throw new Error("should have thrown");
    } catch (err) {
      expect(err instanceof AppError).toBe(true);
      expect((err as AppError).code).toBe("UPSTREAM_ERROR");
      expect((err as AppError).message).toContain("500");
    }
  });

  test("custom kind without baseUrl is rejected before any fetch", async () => {
    let called = false;
    stubFetch(() => {
      called = true;
      return Response.json({ data: [] });
    });
    try {
      await fetchProviderModels({ kind: "custom", apiKey: "k", logger: silentLogger });
      throw new Error("should have thrown");
    } catch (err) {
      expect(err instanceof AppError).toBe(true);
      expect((err as AppError).code).toBe("VALIDATION_FAILED");
      expect(called).toBe(false);
    }
  });
});
