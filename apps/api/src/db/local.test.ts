import { test, expect } from "bun:test";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureLocalKey } from "../lib/local-files";

test("local migrations, key and data survive restart; interrupted writes remain unknown", async () => {
  const folder = mkdtempSync(join(tmpdir(), "mikrotik-db-test-"));
  const key = ensureLocalKey(folder);
  async function runProcess(phase: string) {
    const child = Bun.spawn([process.execPath, join(import.meta.dir, "fixtures/restart.ts"), folder, phase], {
      stdout: "pipe", stderr: "pipe",
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
    ]);
    if (code !== 0) throw new Error(`SQLite ${phase} process failed (${code}): ${stderr}`);
    return stdout;
  }
  try {
    // Real process boundaries also release all native SQLite handles on Windows.
    await runProcess("seed");
    const result = JSON.parse(await runProcess("recover"));
    expect(ensureLocalKey(folder)).toBe(key);
    expect(result.providerKeyMatches).toBe(true);
    expect(result.title).toBe("Persisted");
    expect(result.routerStatus).toBe("disconnected");
    expect(result.writeEnabled).toBe(false);
    expect(result.transactionState).toBe("unknown");
    expect(result.foreignKeyErrors).toEqual([]);
  } finally {
    await rm(folder, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
