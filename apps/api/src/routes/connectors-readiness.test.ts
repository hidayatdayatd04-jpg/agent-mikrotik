import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { createConnectorRoutes } from "./connectors";
import { AppError } from "../lib/errors";
import type { Env } from "../types";
import type { Logger } from "../lib/logger";

const silentLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
} as unknown as Logger;

function buildApp(opts: { mode?: "read-only" | "write"; status?: string; password?: string | null }) {
  const connectors = {
    requireOwned: (_userId: string, connectionId: string) => async () => {
      if (connectionId !== "c1") throw new AppError("NOT_FOUND", "Connector tidak ditemukan.", 404);
      return { id: "c1", routerIdentity: "CHR", host: "h", status: opts.status ?? "connected" };
    },
    getMode: async () => ({ mode: opts.mode ?? "write", version: 7 }),
    decryptCredential: async () => {
      if (opts.password === null || opts.password === undefined) throw new Error("Kredensial tersimpan tidak lengkap.");
      return opts.password;
    },
  };
  const routes = createConnectorRoutes({
    connectors: connectors as never,
    supervisor: { stop: async () => {} } as never,
    txCoordinator: { activeTransactionsForRouter: async () => [], forceRollback: async () => ({ state: "rolled_back" }) } as never,
    safeModeSessions: { forget: () => {} } as never,
    logger: silentLogger,
    invalidateCatalog: () => {},
  });
  const app = new Hono<Env>();
  app.use("*", async (c, next) => {
    c.set("workspace" as never, { userId: "u1" } as never);
    await next();
  });
  app.route("/", routes);
  app.onError((err, c) => {
    if (err instanceof AppError) {
      return c.json({ error: { code: err.code, message: err.message, requestId: "test" } }, err.status as never);
    }
    return c.json({ error: { code: "INTERNAL_ERROR", message: String(err), requestId: "test" } }, 500);
  });
  return app;
}

async function get(app: ReturnType<typeof buildApp>, path: string) {
  const res = await app.fetch(new Request(`http://test${path}`));
  return { status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}

describe("GET /api/connectors/:id/write-readiness", () => {
  test("empty stored credential is reported without leaking the secret", async () => {
    const app = buildApp({ password: "" });
    const { status, body } = await get(app, "/c1/write-readiness");
    expect(status).toBe(200);
    expect(body).toEqual({
      connectorId: "c1",
      status: "connected",
      mode: "write",
      modeVersion: 7,
      credentialEmpty: true,
      blocked: "empty-credential",
    });
    expect(JSON.stringify(body)).not.toContain("password");
  });

  test("stored secret reports ready (no secret content echoed)", async () => {
    const app = buildApp({ password: "s3cr3t" });
    const { body } = await get(app, "/c1/write-readiness");
    expect(body.credentialEmpty).toBe(false);
    expect(body.blocked).toBe(null);
    expect(JSON.stringify(body)).not.toContain("s3cr3t");
  });

  test("read-only mode and disconnected status reported distinctly", async () => {
    const ro = await get(buildApp({ mode: "read-only", password: "" }), "/c1/write-readiness");
    expect(ro.body.blocked).toBe("read-only");
    const disc = await get(buildApp({ status: "disconnected", password: "x" }), "/c1/write-readiness");
    expect(disc.body.blocked).toBe("disconnected");
  });

  test("unreadable credential degrades to credential-unreadable, unknown connector 404s", async () => {
    const app = buildApp({ password: null });
    const { body } = await get(app, "/c1/write-readiness");
    expect(body.credentialEmpty).toBe(null);
    expect(body.blocked).toBe("credential-unreadable");
    const missing = await get(app, "/nope/write-readiness");
    expect(missing.status).toBe(404);
  });
});


test("mode PATCH gates Write using the real service and invalidates only successful changes", async () => {
  const { createDb } = await import("../db");
  const { workspaces, routerConnections } = await import("../db/schema");
  const { createConnectorService } = await import("../services/connector");
  const { createTargetPolicy } = await import("../services/target-policy");
  const { envKeyRing } = await import("../lib/crypto");
  const { eq } = await import("drizzle-orm");
  const db = createDb(":memory:");
  const [user] = await db.insert(workspaces).values({ name: "gating" }).returning();
  const service = createConnectorService({ db, keyRing: envKeyRing({ 1: Buffer.alloc(32, 7).toString("base64") }, 1), targetPolicy: createTargetPolicy([], async () => []), sshTimeoutMs: 1000, log() {}, probe: async () => ({ ok: true, kind: "ok", fingerprint: "SHA256:test", routerIdentity: "CHR", message: "ok" }) });
  const { connector } = await service.create(user!.id, { label: "router", host: "192.168.88.1", port: 22, username: "admin", password: "test" });
  let invalidations = 0;
  const rolledBack: string[] = [];
  const app = new Hono<Env>();
  app.use("*", async (c, next) => { c.set("workspace", { userId: user!.id }); await next(); });
  app.route("/api/connectors", createConnectorRoutes({ connectors: service, supervisor: { stop: async () => {} } as never, txCoordinator: { activeTransactionsForRouter: async () => [{ id: "live", connectionId: connector.id, state: "active" }], forceRollback: async (id: string) => { rolledBack.push(id); return { state: "rolled_back" }; } } as never, safeModeSessions: { forget() {} }, logger: silentLogger, invalidateCatalog: () => { invalidations++; } }));
  app.onError((err, c) => c.json({ message: err.message }, err instanceof AppError ? err.status as 409 : 500));
  const patch = (mode: string, expectedVersion: number) => app.request(`/api/connectors/${connector.id}/mode`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode, expectedVersion }) });
  await service.disconnect(user!.id, connector.id);
  const version = (await service.getMode(user!.id, connector.id)).version;
  const disconnected = await patch("write", version);
  expect(disconnected.status).toBe(409);
  expect(await disconnected.text()).toContain("Sambungkan router");
  for (const status of ["failed", "unverified"]) {
    await db.update(routerConnections).set({ status }).where(eq(routerConnections.id, connector.id));
    expect((await patch("write", version)).status).toBe(409);
  }
  await db.update(routerConnections).set({ status: "connected", routerIdentity: null }).where(eq(routerConnections.id, connector.id));
  expect((await patch("write", version)).status).toBe(409);
  expect(invalidations).toBe(0);
  await db.update(routerConnections).set({ routerIdentity: "CHR" }).where(eq(routerConnections.id, connector.id));
  await service.connect(user!.id, connector.id);
  const connectedVersion = (await service.getMode(user!.id, connector.id)).version;
  expect((await patch("write", connectedVersion)).status).toBe(200);
  expect((await service.getMode(user!.id, connector.id)).mode).toBe("write");
  expect(invalidations).toBe(1);
  expect((await patch("write", version)).status).toBe(409);
  expect(invalidations).toBe(1);
  await db.update(routerConnections).set({ status: "disconnected", routerIdentity: null }).where(eq(routerConnections.id, connector.id));
  expect((await patch("read-only", connectedVersion + 1)).status).toBe(200);
  expect(rolledBack).toEqual(["live"]);
  expect(invalidations).toBe(2);
});

for (const removing of [false, true]) test(`${removing ? "delete" : "disconnect"} respects physical-router and owner scope`, async () => {
  const rolledBack: string[] = [];
  const active = [
    { id: "own-a", connectionId: "a", lockOwner: "u1", state: "active" },
    { id: "own-b", connectionId: "b", lockOwner: "u1", state: "active" },
    { id: "other", connectionId: "b", lockOwner: "u2", state: "active" },
  ];
  const app = new Hono<Env>();
  app.use("*", async (c, next) => { c.set("workspace", { userId: "u1" }); await next(); });
  app.route("/", createConnectorRoutes({
    connectors: { requireOwned: () => async () => ({ routerIdentity: "CHR" }), disconnect: async () => ({}), remove: async () => {} } as never,
    supervisor: { stop: async () => {} } as never,
    txCoordinator: { activeTransactionsForRouter: async (identity: string) => { expect(identity).toBe("CHR"); return active; }, forceRollback: async (id: string, user: string) => { expect(user).toBe("u1"); rolledBack.push(id); return { state: "rolled_back" }; } } as never,
    safeModeSessions: { forget() {} }, logger: silentLogger, invalidateCatalog() {},
  }));
  const res = await app.request(removing ? "/a" : "/a/disconnect", { method: removing ? "DELETE" : "POST" });
  expect(res.status).toBe(200);
  expect(rolledBack).toEqual(removing ? ["own-a", "own-b"] : ["own-a"]);
});
