import { describe, expect, test, afterAll } from "bun:test";
import { McpSupervisor } from "../mcp/supervisor";
import { makeSpawnPlan } from "../mcp/spawn-plan";
import { RosettaProcess } from "../mcp/rosetta";
import { createLiveCatalogSource } from "./live-catalog";
import { PolicyDispatcher } from "./dispatcher";
import { normalizeCustomTools } from "./normalize";
import { customManifests } from "@mikrotik-tools/index";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const BUN = process.env.BUN_EXECUTABLE ?? "bun";
const logger = { debug(){}, info(){}, warn(){}, error(){} };

const corpusPath = resolve(import.meta.dir, "../../../../tooling/corpus/ros-help.db");

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

const supervisor = new McpSupervisor(
  makeSpawnPlan(BUN),
  { maxPerUser: 4, total: 8, idleTimeoutMs: 600_000, startupTimeoutMs: 30_000 },
  logger as never,
);

const rosetta = new RosettaProcess({
  bunExecutable: BUN,
  rosettaCliPath: fileURLToPath(import.meta.resolve("@tikoci/rosetta/bin/rosetta.js")),
  dbPath: corpusPath,
  logger: logger as never,
});

afterAll(async () => {
  await supervisor.shutdownAll();
  await rosetta.shutdown();
});

describe("policy catalog (live MCP children)", () => {
  test("read-only catalog contains zero mutation tools; write/destructive/unknown excluded", async () => {
    const customTools = normalizeCustomTools(customManifests());
    const source = createLiveCatalogSource({
      getFullChild: () => supervisor.getOrSpawn(spec("00000000-0000-0000-0000-0000000000f1", false)),
      getReadOnlyChild: () => supervisor.getOrSpawn(spec("00000000-0000-0000-0000-0000000000f2", true)),
      rosettaToolNames: async () => {
        const tools = (await rosetta.listTools()) as { name: string; description?: string; inputSchema?: unknown }[];
        return tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }));
      },
      customTools,
    });

    const ro = await source.getCatalog("read-only");
    // 385 read tools upstream + 14 rosetta + 7 custom, minus unknowns
    expect(ro.length).toBeGreaterThan(300);
    expect(ro.length).toBeLessThan(420);
    expect(ro.every((t) => t.risk === "read")).toBe(true);
    // the mutation escape hatches are NOT in the model catalog on read-only
    const names = new Set(ro.map((t) => t.fqName));
    expect(names.has("mt:run_routeros_command")).toBe(false);
    expect(names.has("mt:invoke_tool")).toBe(false);
    // concrete mutation tools must be absent (name heuristics alone are NOT
    // the classifier — create_export is legitimately read-only since /export
    // only writes a backup artifact without changing configuration)
    expect(names.has("mt:add_address")).toBe(false);
    expect(names.has("mt:reset_router")).toBe(false);
    // no write/destructive/unknown tool smuggled into the read catalog
    expect(ro.some((t) => t.risk !== "read")).toBe(false);;
    // documentation + custom tools present
    expect([...names].some((n) => n.startsWith("docs:"))).toBe(true);
    expect([...names].some((n) => n.startsWith("custom:"))).toBe(true);

    const write = await source.getCatalog("write");
    expect(write.length).toBeGreaterThan(ro.length);
    const writeNames = new Set(write.map((t) => t.fqName));
    expect(writeNames.has("mt:run_routeros_command")).toBe(true);
    // unknown-classified still excluded on write
    expect(write.every((t) => t.risk !== "unknown")).toBe(true);
  }, 120_000);

  test("forced mutation dispatch on read-only rejected by the dispatcher", async () => {
    const customTools = normalizeCustomTools(customManifests());
    const source = createLiveCatalogSource({
      getFullChild: () => supervisor.getOrSpawn(spec("00000000-0000-0000-0000-0000000000f1", false)),
      getReadOnlyChild: () => supervisor.getOrSpawn(spec("00000000-0000-0000-0000-0000000000f2", true)),
      rosettaToolNames: async () => [],
      customTools,
    });
    const roTools = await source.getCatalog("read-only");

    const auditLog: { decision: string; code?: string }[] = [];
    const dispatcher = new PolicyDispatcher({
      modeSource: { getMode: async () => ({ mode: "read-only", version: 1 }) },
      catalog: { getCatalog: async () => roTools },
      validator: { validate: () => ({ ok: true }) },
      audit: (e) => auditLog.push({ decision: e.decision, code: e.code }),
    });

    const snapshot = { userId: "u1", connectionId: "c1", mode: "read-only" as const, modeVersion: 1, transactionState: "none" as const };
    const r = await dispatcher.check({
      workspace: { userId: "u1" },
      snapshot,
      // the LLM "forces" the raw-CLI escape hatch even though it was never offered
      toolFqName: "mt:run_routeros_command",
      args: { command: "/system reset-configuration" },
    });
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.code).toBe("TOOL_UNSUPPORTED");
  }, 120_000);
});
