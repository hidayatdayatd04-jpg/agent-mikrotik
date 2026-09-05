import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { eq } from "drizzle-orm";
import { createDb, type Database } from "../db";
import { routerConnections, users } from "../db/schema";
import { createConnectorService } from "./connector";
import { createTargetPolicy } from "./target-policy";
import { envKeyRing } from "../lib/crypto";
import type { SshProbeOptions, SshProbeResult } from "./ssh-probe";

const dbUrl = process.env.DATABASE_URL ?? "postgres://dev:dev@localhost:5432/agent_mikrotik";

let db: Database;
let userId: string | null = null;

/** Probe stub: records calls, returns configurable results per host, with an optional override. */
type ProbeOverride = { password: string; result: SshProbeResult["kind"] };
function makeProbe(results: Record<string, SshProbeResult>) {
  const calls: SshProbeOptions[] = [];
  const state: { override: ProbeOverride | null } = { override: null };
  const fn = async (opts: SshProbeOptions): Promise<SshProbeResult> => {
    calls.push(opts);
    if (state.override && state.override.password === opts.password) {
      return { ok: false, kind: state.override.result, fingerprint: null, routerIdentity: null, message: state.override.result === "auth-failed" ? "Autentikasi SSH gagal (username/password salah)." : "gagal" };
    }
    return results[opts.host] ?? { ok: true, kind: "ok", fingerprint: "SHA256:AAAA", routerIdentity: "router-x", message: "stub ok" };
  };
  return { fn, calls, state };
}

const keyRing = envKeyRing({ 1: Buffer.alloc(32, 7).toString("base64") }, 1);
const staticDns = (map: Record<string, string[]>) => async (h: string) => map[h] ?? [];

describe("connector service (integration, local postgres, stubbed probe)", () => {
  const probe = makeProbe({
    "192.168.88.10": { ok: false, kind: "auth-failed", fingerprint: null, routerIdentity: null, message: "Autentikasi SSH gagal (username/password salah)." },
    "10.0.0.5": { ok: false, kind: "unreachable", fingerprint: null, routerIdentity: null, message: "Host tidak terjangkau: down" },
  });

  beforeAll(async () => {
    try {
      db = createDb(dbUrl);
      await db.execute("select 1");
    } catch {
      console.log("no local postgres; skipping connector integration tests");
      return;
    }
    const [u] = await db.insert(users).values({ email: `connector-test-${Date.now()}@example.com`, name: "Connector Test" }).returning();
    userId = u!.id;
  });

  afterAll(async () => {
    if (userId) await db.delete(users).where(eq(users.id, userId));
  });

  function makeService() {
    return createConnectorService({
      db,
      keyRing,
      targetPolicy: createTargetPolicy([], staticDns({})),
      sshTimeoutMs: 1000,
      log: () => {},
      probe: probe.fn,
    });
  }

  test("create: loopback target rejected before any probe/persist", async () => {
    if (!userId) return;
    const svc = makeService();
    await expect(
      svc.create(userId, { label: "loop", host: "127.0.0.1", port: 22, username: "admin", password: "pw" }),
    ).rejects.toThrow(/loopback/);
    const rows = await db.select().from(routerConnections).where(eq(routerConnections.userId, userId));
    expect(rows.length).toBe(0);
    expect(probe.calls.length).toBe(0);
  });

  test("create: auth failure classified, nothing persisted", async () => {
    if (!userId) return;
    const svc = makeService();
    await expect(
      svc.create(userId, { label: "bad", host: "192.168.88.10", port: 22, username: "admin", password: "pw" }),
    ).rejects.toThrow(/Autentikasi SSH gagal/);
    const rows = await db.select().from(routerConnections).where(eq(routerConnections.userId, userId));
    expect(rows.length).toBe(0);
  });

  test("create: success seals credential + pins fingerprint; update with wrong password keeps old credential", async () => {
    if (!userId) return;
    const svc = makeService();
    const { connector, probe: p } = await svc.create(userId, { label: "rt", host: "192.168.88.20", port: 22, username: "admin", password: "secret1" });
    expect(p.ok).toBe(true);
    expect(connector.status).toBe("connected");
    expect(connector.mode).toBe("read-only");
    expect(connector.hostKeyFingerprint).toBe("SHA256:AAAA");

    // credential is NOT plaintext in the database
    const [row] = await db.select().from(routerConnections).where(eq(routerConnections.id, connector.id));
    expect(row!.passwordCiphertext).not.toContain("secret1");
    // decrypt works via the service
    expect(await svc.decryptCredential(userId, connector.id)).toBe("secret1");

    // update with a FAILING new password: error, old credential stays usable
    probe.state.override = { password: "wrongpw", result: "auth-failed" };
    await expect(
      svc.update(userId, connector.id, { password: "wrongpw" }),
    ).rejects.toThrow(/Autentikasi SSH gagal/);
    probe.state.override = null;
    expect(await svc.decryptCredential(userId, connector.id)).toBe("secret1");
  }, 20_000);

  test("setMode CAS: stale version rejected with POLICY_CHANGED", async () => {
    if (!userId) return;
    const svc = makeService();
    const { connector } = await svc.create(userId, { label: "rt2", host: "192.168.88.21", port: 22, username: "admin", password: "secret2" });
    const r1 = await svc.setMode(userId, connector.id, "write", 1);
    expect(r1.connector.mode).toBe("write");
    expect(r1.version).toBe(2);
    // stale expectedVersion=1 must fail now
    await expect(svc.setMode(userId, connector.id, "read-only", 1)).rejects.toThrow(/Mode berubah/);
    await expect(svc.setMode(userId, connector.id, "read-only", 2)).resolves.toMatchObject({ version: 3 });
  }, 20_000);

  test("disconnect revokes write mode", async () => {
    if (!userId) return;
    const svc = makeService();
    const { connector } = await svc.create(userId, { label: "rt3", host: "192.168.88.22", port: 22, username: "admin", password: "secret3" });
    await svc.setMode(userId, connector.id, "write", 1);
    const out = await svc.disconnect(userId, connector.id);
    expect(out.mode).toBe("read-only");
    expect(out.status).toBe("disconnected");
    const mode = await svc.getMode(userId, connector.id);
    expect(mode.mode).toBe("read-only");
  }, 20_000);

  test("update re-probes when host changes; unreachable classified", async () => {
    if (!userId) return;
    const svc = makeService();
    const { connector } = await svc.create(userId, { label: "rt4", host: "192.168.88.23", port: 22, username: "admin", password: "secret4" });
    await expect(
      svc.update(userId, connector.id, { host: "10.0.0.5" }),
    ).rejects.toThrow(/tidak terjangkau/);
    // host unchanged in DB because update failed
    const [row] = await db.select().from(routerConnections).where(eq(routerConnections.id, connector.id));
    expect(row!.host).toBe("192.168.88.23");
  }, 20_000);
});
