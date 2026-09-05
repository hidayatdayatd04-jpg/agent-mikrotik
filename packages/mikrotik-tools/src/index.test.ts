import { describe, expect, test } from "bun:test";
import { command, quoteValue, escapeValue } from "./command-builder";
import { parseValueList, detectError, parseFlags } from "./output-parser";
import { CUSTOM_TOOLS, customManifests } from "./tools";
import type { RouterOsExecutor, ToolContext } from "./executor";

describe("RouterOS quoting", () => {
  test("plain values pass through", () => {
    expect(quoteValue("ether1")).toBe("ether1");
    expect(quoteValue("192.168.88.1")).toBe("192.168.88.1");
  });

  test("values with spaces/quotes are escaped", () => {
    expect(quoteValue("my iface")).toBe('"my iface"');
    expect(quoteValue('say "hi"')).toBe('"say \\"hi\\""');
    expect(escapeValue("a\\b")).toBe("a\\\\b");
    expect(quoteValue("a\\b")).toBe('"a\\\\b"');
  });

  test("hostile value cannot break out of quoting", () => {
    const evil = 'x"; /system reset-configuration; #';
    const q = quoteValue(evil);
    expect(q.startsWith('"')).toBe(true);
    // the embedded quotes are escaped — no unescaped quote remains
    expect(q.match(/(?<!\\)"/g)?.length).toBe(2); // opening + closing only
  });

  test("separators force quoting", () => {
    expect(quoteValue("a,b")).toBe('"a,b"');
    expect(quoteValue("a/b")).toBe('"a/b"');
  });
});

describe("command builder", () => {
  test("menu + op + args", () => {
    const cmd = command().menu("ip", "firewall", "filter").op("add").arg("chain", "input").arg("action", "drop").arg("comment", "block attacker").build();
    expect(cmd).toBe('ip firewall filter add chain=input action=drop comment="block attacker"');
  });

  test("print detail where", () => {
    const cmd = command().menu("interface", "bonding").op("print").flag("detail").where("name", "bond1").build();
    expect(cmd).toBe('interface bonding print detail where name="bond1"');
  });

  test("remove by stable .id", () => {
    const cmd = command().menu("ip", "address").op("remove").whereId("*3").build();
    expect(cmd).toBe("ip address remove .id=\"*3\"");
  });

  test("invalid identifiers rejected", () => {
    expect(() => command().menu("ip firewall; rm -rf")).toThrow();
    expect(() => command().op("print file")).toThrow();
    expect(() => command().arg("bad name", "x")).toThrow();
  });

  test("boolean args encode yes/no", () => {
    const cmd = command().menu("ip", "smb").op("set").arg("enabled", true).build();
    expect(cmd).toBe("ip smb set enabled=yes");
  });
});

describe("output parser", () => {
  test("value-list rows with flags and .id", () => {
    const out = [
      'Flags: X - disabled',
      '0 X name="bond1" mtu=1500 slaves=ether1,ether2 .id="*1"',
      '1  name="bond2" mtu=1500 slaves=ether3 .id="*2"',
    ].join("\n");
    const parsed = parseValueList(out);
    expect(parsed.ok).toBe(true);
    expect(parsed.rows.length).toBe(2);
    expect(parsed.rows[0]!.index).toBe(0);
    expect(parsed.rows[0]!.flags).toBe("X");
    expect(parsed.rows[0]!.id).toBe("*1");
    expect(parsed.rows[0]!.fields["slaves"]).toBe("ether1,ether2");
    expect(parsed.rows[1]!.id).toBe("*2");
  });

  test("empty output is ok with zero rows", () => {
    const parsed = parseValueList("");
    expect(parsed.ok).toBe(true);
    expect(parsed.rows.length).toBe(0);
  });

  test("error lines detected", () => {
    expect(detectError("failure: no such item")).toContain("no such item");
    expect(detectError("syntax error (line 1)")).toContain("syntax error");
    const parsed = parseValueList("no such item\n");
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toContain("no such item");
  });

  test("multi-line continuation values", () => {
    const out = '0  name="wan1" comment="multi\nline comment" .id="*9"';
    const parsed = parseValueList(out);
    expect(parsed.rows[0]!.fields["name"]).toBe("wan1");
  });

  test("flags parsing helper", () => {
    expect(parseFlags("X rest of it")).toEqual({ flags: "X", rest: "rest of it" });
    expect(parseFlags("plain")).toEqual({ flags: "", rest: "plain" });
  });
});

describe("custom tools (fake executor)", () => {
  function makeExecutor(opts: { menus: string[]; outputs?: Record<string, string> } = { menus: [] }): RouterOsExecutor {
    return {
      async exec(cmd: string) {
        const out = opts.outputs?.[cmd] ?? "";
        return { stdout: out, stderr: "" };
      },
      async hasMenu(menu: string) {
        return opts.menus.includes(menu);
      },
    };
  }
  function makeCtx(ex: RouterOsExecutor): ToolContext {
    return { executor: ex, redact: (t) => t.replace(/community="[^"]*"/g, 'community="[REDACTED]"') };
  }

  test("all custom tools expose manifests with unique ids", () => {
    const manifests = customManifests();
    expect(manifests.length).toBe(7);
    const ids = new Set(manifests.map((m) => m.id));
    expect(ids.size).toBe(7);
    for (const m of manifests) {
      expect(m.origin).toBe("custom");
      expect(m.risk).toBe("read-only");
      expect(m.commandPath).toBeTruthy();
      expect(m.id.startsWith("custom_")).toBe(true);
    }
  });

  test("listBonding: available menu returns rows; missing menu returns TOOL_UNSUPPORTED", async () => {
    const ok = CUSTOM_TOOLS[0]!;
    const ctxOk = makeCtx(makeExecutor({
      menus: ["/interface bonding"],
      outputs: { 'interface bonding print detail': '0  name="bond1" slaves=ether1 .id="*1"' },
    }));
    const r1 = await ok.run({}, ctxOk);
    expect(r1.ok).toBe(true);
    expect((r1.data as { rows: { fields: Record<string, string> }[] }).rows[0]!.fields["name"]).toBe("bond1");

    const ctxNo = makeCtx(makeExecutor({ menus: [] }));
    const r2 = await ok.run({}, ctxNo);
    expect(r2.ok).toBe(false);
    expect(r2.error?.code).toBe("TOOL_UNSUPPORTED");
  });

  test("listBonding: invalid input rejected", async () => {
    const ctx = makeCtx(makeExecutor({ menus: ["/interface bonding"] }));
    const r = await CUSTOM_TOOLS[0]!.run({ name: "bad name with spaces" }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe("VALIDATION_FAILED");
  });

  test("listSnmp: community secret redacted", async () => {
    const snmp = CUSTOM_TOOLS.find((t) => t.manifest.id === "custom_list_snmp")!;
    const ctx = makeCtx(makeExecutor({
      menus: ["/snmp"],
      outputs: {
        "snmp print": "enabled=yes",
        "snmp communities print": '0  name="public" community="s3cret" .id="*1"',
      },
    }));
    const r = await snmp.run({}, ctx);
    expect(r.ok).toBe(true);
    const data = r.data as { communities: { fields: Record<string, string> }[] };
    expect(data.communities[0]!.fields["community"]).toBe("[REDACTED]");
  });

  test("listMpls: section routing builds correct commands", async () => {
    const mpls = CUSTOM_TOOLS.find((t) => t.manifest.id === "custom_list_mpls")!;
    const ctx = makeCtx(makeExecutor({ menus: ["/mpls"] }));
    const r = await mpls.run({ section: "ldp" }, ctx);
    expect(r.ok).toBe(true);
  });
});
