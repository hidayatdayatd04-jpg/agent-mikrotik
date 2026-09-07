import { describe, expect, test } from "bun:test";
import { createSafeModeSessionFactory } from "./mcp-session";
import type { Logger } from "../lib/logger";

const logger: Logger = { debug() {}, info() {}, warn() {}, error() {} };
const CTX = { userId: "u1", connectionId: "c1", routerIdentity: "CHR" };
const SPEC = { host: "h", port: 22, username: "u", password: "p", hostKeyFingerprint: null };

function textResult(text: string) {
  return { content: [{ type: "text", text }], isError: false };
}

/** Scripted child: behaviors run in order per tool call; "hang" never resolves. */
function makeHarness(script: { tool: string; respond: string | "hang" | "error" }[]) {
  const calls: string[] = [];
  const stops: string[] = [];
  let i = 0;
  const child = {
    client: {
      async callTool({ name }: { name: string }) {
        calls.push(name);
        const step = script[Math.min(i++, script.length - 1)]!;
        if (step.tool !== name) throw new Error(`unexpected tool call ${name}, expected ${step.tool}`);
        if (step.respond === "hang") return new Promise(() => {});
        if (step.respond === "error") return { content: [], isError: true };
        return textResult(step.respond);
      },
    },
  };
  const factory = createSafeModeSessionFactory({
    supervisor: {
      getOrSpawn: async () => child,
      stop: async (userId: string, connectionId: string) => {
        stops.push(`${userId}:${connectionId}`);
      },
    } as never,
    logger,
    getConnection: async () => ({ userId: "u1", connectionId: "c1", spec: SPEC }),
    probeTimeoutMs: 60,
  });
  return { factory, calls, stops };
}

describe("openVerifiedSession self-healing", () => {
  test("healthy child: enable + probe pass, no recycle", async () => {
    const { factory, calls, stops } = makeHarness([
      { tool: "enable_safe_mode", respond: "Safe mode ENABLED. temporary." },
      { tool: "get_system_identity", respond: "name: CHR" },
    ]);
    const session = await factory.openVerifiedSession(CTX);
    expect(session).toBeTruthy();
    expect(calls).toEqual(["enable_safe_mode", "get_system_identity"]);
    expect(stops).toEqual([]);
  });

  test("stale flag + wedged shell: probe times out, child recycled, retry succeeds", async () => {
    const { factory, calls, stops } = makeHarness([
      { tool: "enable_safe_mode", respond: "Safe mode is already active." },
      { tool: "get_system_identity", respond: "hang" },
      { tool: "enable_safe_mode", respond: "Safe mode ENABLED. temporary." },
      { tool: "get_system_identity", respond: "name: CHR" },
    ]);
    const session = await factory.openVerifiedSession(CTX);
    expect(session).toBeTruthy();
    expect(stops).toEqual(["u1:c1"]);
    expect(calls).toEqual(["enable_safe_mode", "get_system_identity", "enable_safe_mode", "get_system_identity"]);
  });

  test("persistently wedged: both attempts fail, child recycled twice, typed error", async () => {
    const { factory, stops } = makeHarness([
      { tool: "enable_safe_mode", respond: "Safe mode ENABLED. temporary." },
      { tool: "get_system_identity", respond: "hang" },
      { tool: "enable_safe_mode", respond: "Safe mode ENABLED. temporary." },
      { tool: "get_system_identity", respond: "hang" },
    ]);
    const err = await factory.openVerifiedSession(CTX).then(
      () => null,
      (e: Error) => e,
    );
    expect(err).not.toBe(null);
    expect(String((err as Error).message)).toMatch(/tidak dapat dipakai/);
    expect(stops).toEqual(["u1:c1", "u1:c1"]);
  });
});
