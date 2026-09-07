import { expect, test } from "bun:test";
import { Hono } from "hono";
import { createAiProviderRoutes } from "./ai-provider";
import { createProviderSettingsService } from "../agent/provider-settings";
import { createDb } from "../db";
import { workspaces } from "../db/schema";
import { envKeyRing } from "../lib/crypto";
import { AppError } from "../lib/errors";
import type { Env } from "../types";
import type { Logger } from "../lib/logger";

test("model discovery resolves the exact saved provider including disabled configurations without exposing keys", async () => {
  const keys: (string | null)[] = [];
  const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch(req) {
    keys.push(req.headers.get("authorization"));
    return Response.json({ data: [{ id: "test-model" }] });
  } });
  try {
    const db = createDb(":memory:");
    const [user] = await db.insert(workspaces).values({ name: "discovery" }).returning();
    const logger: Logger = { debug() {}, info() {}, warn() {}, error() {} };
    const providers = createProviderSettingsService({ db, logger, keyRing: envKeyRing({ 1: Buffer.alloc(32, 7).toString("base64") }, 1) });
    await providers.save(user!.id, { id: "custom-b", kind: "custom", baseUrl: `http://127.0.0.1:${server.port}/v1`, apiKey: "saved-b-secret", models: ["test-model"], enabled: false });
    const app = new Hono<Env>();
    app.use("*", async (c, next) => { c.set("workspace", { userId: user!.id }); await next(); });
    app.route("/", createAiProviderRoutes({ providers, logger }));
    app.onError((err, c) => c.json({ error: err.message }, err instanceof AppError ? err.status as 422 : 500));
    const request = (body: unknown) => app.request("/models", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const res = await request({ kind: "custom", providerId: "custom-b" });
    expect(res.status).toBe(200);
    expect(await res.text()).not.toContain("saved-b-secret");
    expect(keys).toEqual(["Bearer saved-b-secret"]);
    expect((await request({ kind: "custom", providerId: "custom-b", baseUrl: "https://different.example/v1" })).status).toBe(422);
    expect(keys).toHaveLength(1);
  } finally { server.stop(true); }
});
