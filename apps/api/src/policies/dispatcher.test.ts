import { describe, expect, test } from "bun:test";
import { normalizeUpstreamTools, normalizeCustomTools, type NormalizedTool } from "./normalize";
import { PolicyDispatcher, buildModeCatalog, type ModeSource, type SchemaValidator } from "./dispatcher";

function makeValidator(): SchemaValidator {
  return {
    validate(schema: unknown, input: unknown) {
      if (schema && typeof schema === "object" && (schema as { required?: string[] }).required) {
        const required = (schema as { required: string[] }).required;
        if (input && typeof input === "object") {
          for (const r of required) {
            if (!(r in (input as Record<string, unknown>))) {
              return { ok: false, message: `missing ${r}` };
            }
          }
        }
      }
      return { ok: true };
    },
  };
}

const AUDIT: { userId: string; tool: string; decision: string; code?: string }[] = [];

function makeDispatcher(modeSource: ModeSource, catalog: NormalizedTool[]) {
  return new PolicyDispatcher({
    modeSource,
    catalog: { getCatalog: async (m) => buildModeCatalog(catalog, m) },
    validator: makeValidator(),
    audit: (e) => AUDIT.push(e),
  });
}

const UPSTREAM_FULL = [
  { name: "find_tools", description: "search", annotations: { readOnlyHint: true } },
  { name: "list_addresses", description: "list ip addresses", annotations: { readOnlyHint: true } },
  { name: "add_address", description: "add ip address", annotations: { destructiveHint: false, readOnlyHint: false } },
  { name: "reset_router", description: "reset config", annotations: { destructiveHint: true } },
  // contradicts: claims read-only but excluded from read-only registration
  { name: "sneaky_read", description: "x", annotations: { readOnlyHint: true } },
  // no annotation at all, not in read-only registration
  { name: "mystery_tool", description: "x", annotations: {} },
  { name: "invoke_tool", description: "invoke any tool by name", annotations: { readOnlyHint: false } },
  { name: "run_routeros_command", description: "raw cli", annotations: { readOnlyHint: false } },
];

const UPSTREAM_RO = UPSTREAM_FULL.filter((t) => !["add_address", "reset_router", "sneaky_read", "mystery_tool", "invoke_tool", "run_routeros_command"].includes(t.name));

const catalog = [
  ...normalizeUpstreamTools(UPSTREAM_FULL, UPSTREAM_RO, "upstream-mikrotik", "mt"),
  ...normalizeCustomTools([
    {
      id: "custom_list_bonding_interfaces",
      version: "1.0.0",
      origin: "custom",
      description: "list bonding",
      inputSchema: { type: "object" },
      risk: "read-only",
      capabilities: ["interface-bonding"],
      timeoutMs: 20_000,
      idempotent: true,
      sensitiveFields: [],
      recoveryStrategy: "none",
      commandPath: "/interface bonding",
    },
  ]),
];

const snapshot = {
  userId: "u1",
  connectionId: "c1",
  mode: "read-only" as const,
  modeVersion: 3,
  transactionState: "none" as const,
};

describe("normalize + risk classification provenance", () => {
  test("read-only requires BOTH annotation and read-only registration", () => {
    const t = catalog.find((x) => x.fqName === "mt:list_addresses")!;
    expect(t.risk).toBe("read");
    expect(t.classificationProvenance).toBe("upstream-annotation+read-only-registration");
  });

  test("annotation contradiction → unknown, not read", () => {
    const t = catalog.find((x) => x.fqName === "mt:sneaky_read")!;
    expect(t.risk).toBe("unknown");
    expect(t.classificationProvenance).toBe("none");
  });

  test("unannotated tool → unknown until reviewed (no get_/list_ guessing)", () => {
    const t = catalog.find((x) => x.fqName === "mt:mystery_tool")!;
    expect(t.risk).toBe("unknown");
  });

  test("destructive annotation honored", () => {
    const t = catalog.find((x) => x.fqName === "mt:reset_router")!;
    expect(t.risk).toBe("destructive");
  });

  test("gateway tools flagged", () => {
    expect(catalog.find((x) => x.fqName === "mt:invoke_tool")!.isGateway).toBe(true);
    expect(catalog.find((x) => x.fqName === "mt:run_routeros_command")!.isGateway).toBe(true);
  });
});

describe("buildModeCatalog", () => {
  test("read-only catalog: only verified read tools, no unknown/write/destructive, no gateway", () => {
    const ro = buildModeCatalog(catalog, "read-only");
    const names = ro.map((t) => t.fqName);
    expect(names).toContain("mt:list_addresses");
    expect(names).toContain("mt:find_tools");
    expect(names).toContain("custom:custom_list_bonding_interfaces");
    expect(names).not.toContain("mt:add_address");
    expect(names).not.toContain("mt:reset_router");
    expect(names).not.toContain("mt:sneaky_read");
    expect(names).not.toContain("mt:mystery_tool");
    expect(names).not.toContain("mt:run_routeros_command");
    expect(ro.every((t) => t.risk === "read")).toBe(true);
  });

  test("write catalog: everything classified (no silent top-k trimming)", () => {
    const w = buildModeCatalog(catalog, "write");
    const names = w.map((t) => t.fqName);
    expect(names).toContain("mt:add_address");
    expect(names).toContain("mt:reset_router");
    expect(names).toContain("mt:find_tools");
    expect(names).toContain("custom:custom_list_bonding_interfaces");
    // unknown stays excluded even in write mode
    expect(names).not.toContain("mt:sneaky_read");
    expect(names).not.toContain("mt:mystery_tool");
  });
});

describe("dispatcher re-checks", () => {
  const live = { mode: "read-only" as const, version: 3 };

  test("read tool allowed on read-only", async () => {
    const d = makeDispatcher({ getMode: async () => live }, catalog);
    const r = await d.check({ session: { userId: "u1" }, snapshot, toolFqName: "mt:list_addresses", args: {} });
    expect(r.allowed).toBe(true);
  });

  test("mutation tool never reaches LLM nor executes on read-only — forced call rejected", async () => {
    const d = makeDispatcher({ getMode: async () => live }, catalog);
    const r = await d.check({ session: { userId: "u1" }, snapshot, toolFqName: "mt:add_address", args: {} });
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.code).toBe("TOOL_UNSUPPORTED");
  });

  test("unknown-classified tool rejected in both modes", async () => {
    const d = makeDispatcher({ getMode: async () => ({ mode: "write", version: 3 }) }, catalog);
    const r = await d.check({ session: { userId: "u1" }, snapshot: { ...snapshot, mode: "write" }, toolFqName: "mt:mystery_tool", args: {} });
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.code).toBe("TOOL_UNSUPPORTED");
  });

  test("A08 race: Write OFF from another tab kills in-flight dispatch (stale snapshot)", async () => {
    // snapshot says write v3, but live mode was switched to read-only v4 by another tab
    const d = makeDispatcher(
      { getMode: async () => ({ mode: "read-only", version: 4 }) },
      catalog,
    );
    const r = await d.check({
      session: { userId: "u1" },
      snapshot: { ...snapshot, mode: "write" },
      toolFqName: "mt:add_address",
      args: {},
    });
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.code).toBe("POLICY_CHANGED");
  });

  test("A10: gateway cannot smuggle a write tool through read-only", async () => {
    // build a read-mode dispatcher where invoke_tool was (mistakenly) offered;
    // even then the inner target must be read
    const d = makeDispatcher({ getMode: async () => live }, catalog);
    // find_tools is read; use its namespace trick: gateway denied because gateway not in RO catalog
    const r = await d.check({ session: { userId: "u1" }, snapshot, toolFqName: "mt:invoke_tool", args: { name: "mt:list_addresses" } });
    expect(r.allowed).toBe(false); // invoke_tool itself is not in the RO catalog
    if (!r.allowed) expect(r.code).toBe("TOOL_UNSUPPORTED");

    // defense in depth: even with a permissive catalog offering the gateway,
    // inner write tool is refused
    const permissive = catalog.map((t) => (t.fqName === "mt:invoke_tool" ? { ...t, risk: "read" as const } : t));
    const d2 = makeDispatcher({ getMode: async () => live }, permissive);
    const r2 = await d2.check({ session: { userId: "u1" }, snapshot, toolFqName: "mt:invoke_tool", args: { name: "mt:add_address" } });
    expect(r2.allowed).toBe(false);
    if (!r2.allowed) expect(r2.code).toBe("WRITE_DISABLED");
  });

  test("A30: LLM cannot set host/credential/target args", async () => {
    const d = makeDispatcher({ getMode: async () => live }, catalog);
    const r = await d.check({ session: { userId: "u1" }, snapshot, toolFqName: "mt:list_addresses", args: { host: "10.0.0.1" } });
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.code).toBe("FORBIDDEN");
  });

  test("session/owner mismatch rejected", async () => {
    const d = makeDispatcher({ getMode: async () => live }, catalog);
    const noSession = await d.check({ session: null, snapshot, toolFqName: "mt:list_addresses", args: {} });
    expect(noSession.allowed).toBe(false);
    const wrongOwner = await d.check({ session: { userId: "someone-else" }, snapshot, toolFqName: "mt:list_addresses", args: {} });
    expect(wrongOwner.allowed).toBe(false);
  });

  test("schema validation failure rejected", async () => {
    const strict = [
      ...catalog,
      {
        fqName: "mt:strict_tool",
        rawName: "strict_tool",
        origin: "upstream-mikrotik" as const,
        risk: "read" as const,
        classificationProvenance: "upstream-annotation+read-only-registration" as const,
        capabilities: [],
        inputSchema: { required: ["query"] },
        description: "",
        isGateway: false,
      },
    ];
    const d = makeDispatcher({ getMode: async () => live }, strict);
    const bad = await d.check({ session: { userId: "u1" }, snapshot, toolFqName: "mt:strict_tool", args: {} });
    expect(bad.allowed).toBe(false);
    if (!bad.allowed) expect(bad.code).toBe("VALIDATION_FAILED");
    const good = await d.check({ session: { userId: "u1" }, snapshot, toolFqName: "mt:strict_tool", args: { query: "x" } });
    expect(good.allowed).toBe(true);
  });

  test("write-mode mutation requires an active safe-mode transaction", async () => {
    const liveWrite = { mode: "write" as const, version: 3 };
    const d = makeDispatcher({ getMode: async () => liveWrite }, catalog);
    const r = await d.check({
      session: { userId: "u1" },
      snapshot: { ...snapshot, mode: "write" },
      toolFqName: "mt:add_address",
      args: {},
    });
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.code).toBe("SAFE_MODE_UNAVAILABLE");
  });

  test("audit records denials with codes", async () => {
    AUDIT.length = 0;
    const d = makeDispatcher({ getMode: async () => live }, catalog);
    await d.check({ session: { userId: "u1" }, snapshot, toolFqName: "mt:add_address", args: {} });
    expect(AUDIT.some((a) => a.decision === "denied")).toBe(true);
  });
});
