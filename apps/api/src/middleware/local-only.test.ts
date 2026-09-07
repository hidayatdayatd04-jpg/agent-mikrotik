import { test, expect } from "bun:test";
import { Hono } from "hono";
import { localOnly } from "./local-only";
import { AppError } from "../lib/errors";

test("local API needs no login and rejects remote origins, rebinding and cross-site forms", async () => {
  const app = new Hono();
  app.use("*", localOnly(3000));
  app.all("/api/test", (c) => c.json({ ok: true }));
  app.onError((err, c) => c.json({}, err instanceof AppError ? 403 : 500));
  expect((await app.request("http://localhost:3000/api/test")).status).toBe(200);
  expect((await app.request("http://localhost:3000/api/test", { method: "POST", headers: { Origin: "http://localhost:3000" } })).status).toBe(200);
  const rejected: Record<string, string>[] = [{ Origin: "https://evil.test" }, { Origin: "null" }, { Host: "evil.test:3000" }, { "Sec-Fetch-Site": "cross-site" }];
  for (const headers of rejected) {
    const response = await app.request("http://localhost:3000/api/test", { method: "POST", headers });
    expect(response.status).toBe(403);
  }
});
