import { describe, expect, test, afterAll } from "bun:test";
import { McpSupervisor } from "./supervisor";
import { makeSpawnPlan } from "./spawn-plan";

const BUN = process.env.BUN_EXECUTABLE ?? "bun";

function spec(connectionId: string, readOnly: boolean) {
  return {
    connectionId,
    userId: "00000000-0000-0000-0000-000000000001",
    host: "192.168.88.1",
    port: 22,
    username: "admin",
    password: null,
    hostKeyFingerprint: null,
    readOnly,
  };
}

const logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

const supervisor = new McpSupervisor(
  makeSpawnPlan(BUN),
  { maxPerUser: 2, total: 4, idleTimeoutMs: 300_000, startupTimeoutMs: 30_000 },
  logger as never,
);

async function countTools(child: { client: { listTools: (o: { cursor?: string }) => Promise<{ tools?: unknown[]; nextCursor?: string }> } }): Promise<number> {
  let n = 0;
  let cursor: string | undefined;
  do {
    const page = await child.client.listTools({ cursor });
    n += (page.tools ?? []).length;
    cursor = page.nextCursor;
  } while (cursor);
  return n;
}

afterAll(async () => {
  await supervisor.shutdownAll();
});

describe("McpSupervisor (real child process)", () => {
  test("spawns full-mode child and lists the complete catalog", async () => {
    const child = await supervisor.getOrSpawn(spec("00000000-0000-0000-0000-0000000000a1", false));
    expect(child.spec.readOnly).toBe(false);
    // M0 spike proved the full catalog has 891 tools; tolerate minor drift but require the bulk.
    expect(await countTools(child)).toBeGreaterThan(800);
  }, 60_000);

  test("same key reuses the child; read-only mode change respawns with filtered catalog", async () => {
    const fullChild = await supervisor.getOrSpawn(spec("00000000-0000-0000-0000-0000000000a1", false));
    const again = await supervisor.getOrSpawn(spec("00000000-0000-0000-0000-0000000000a1", false));
    expect(again).toBe(fullChild);
    expect(supervisor.count()).toBe(1);

    // switch to read-only: must be a NEW process with a filtered registration
    const roChild = await supervisor.getOrSpawn(spec("00000000-0000-0000-0000-0000000000a1", true));
    expect(roChild).not.toBe(fullChild);
    expect(supervisor.count()).toBe(1);

    // M0 spike: read-only registration is 385 tools.
    const n = await countTools(roChild);
    expect(n).toBeGreaterThan(300);
    expect(n).toBeLessThan(500);
  }, 60_000);

  test("per-user limit enforced", async () => {
    // user already holds 1 child (a1 from the tests above, now read-only)
    await supervisor.getOrSpawn(spec("00000000-0000-0000-0000-0000000000b1", true));
    expect(supervisor.count()).toBe(2);
    // maxPerUser=2 reached: the next spawn for this user must be rejected
    await expect(
      supervisor.getOrSpawn(spec("00000000-0000-0000-0000-0000000000b2", true)),
    ).rejects.toThrow(/Batas proses MCP per user/);
    expect(supervisor.count()).toBe(2);
  }, 60_000);

  test("idle timeout closes child without orphan process", async () => {
    const idle = new McpSupervisor(
      makeSpawnPlan(BUN),
      { maxPerUser: 2, total: 4, idleTimeoutMs: 1_500, startupTimeoutMs: 30_000 },
      logger as never,
    );
    const child = await idle.getOrSpawn(spec("00000000-0000-0000-0000-0000000000c1", true));
    expect(idle.count()).toBe(1);
    // wait past the idle timeout; supervisor must stop the child
    await new Promise((r) => setTimeout(r, 3_000));
    expect(idle.count()).toBe(0);
    // transport must actually be closed
    await expect(child.client.listTools({})).rejects.toThrow();
    await idle.shutdownAll();
  }, 60_000);

  test("crashed child is respawned on next getOrSpawn (bounded, on-demand)", async () => {
    const sup = new McpSupervisor(
      makeSpawnPlan(BUN),
      { maxPerUser: 2, total: 4, idleTimeoutMs: 300_000, startupTimeoutMs: 30_000 },
      logger as never,
    );
    const first = await sup.getOrSpawn(spec("00000000-0000-0000-0000-0000000000d1", true));
    // simulate crash: kill the underlying process via transport close
    await first.transport.close().catch(() => {});
    // give the close event a moment to propagate
    await new Promise((r) => setTimeout(r, 500));
    // next request must get a fresh, working child
    const second = await sup.getOrSpawn(spec("00000000-0000-0000-0000-0000000000d1", true));
    expect(second).not.toBe(first);
    expect(await countTools(second)).toBeGreaterThan(300);
    await sup.shutdownAll();
  }, 60_000);
});
