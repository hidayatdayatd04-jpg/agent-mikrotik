import { resolve } from "node:path";
import { existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import type { ConnectionSpec, SpawnPlan } from "./supervisor";

/**
 * Build the spawn command + minimal env for a mikrotik-mcp child process.
 * Only MIKROTIK_* connection variables and a fixed safe baseline are set —
 * the app's process.env is never inherited. Each child gets its own
 * working directory so config/log/cache artifacts never mix between users.
 */
export function makeSpawnPlan(bunExecutable: string): (spec: ConnectionSpec) => SpawnPlan {
  // Resolve the pinned dependency at startup, not per-spawn.
  const cliPath: string = resolveMikrotikCliPath();

  return (spec: ConnectionSpec): SpawnPlan => {
    const args = [cliPath];
    const env: Record<string, string> = {
      MIKROTIK_HOST: spec.host,
      MIKROTIK_PORT: String(spec.port),
      MIKROTIK_USERNAME: spec.username,
      MIKROTIK_DISABLE_UPDATE_CHECK: "1",
      MIKROTIK_LOG_LEVEL: "info",
    };
    if (spec.password) env.MIKROTIK_PASSWORD = spec.password;
    if (spec.readOnly) env.MIKROTIK_READ_ONLY = "1";
    const cwd = resolve(tmpdir(), "agent-mikrotik-mcp", spec.userId, spec.connectionId);
    mkdirSync(cwd, { recursive: true });
    return { command: bunExecutable, args, env, cwd };
  };
}

/**
 * Resolve the pinned CLI entrypoint. The package "exports" map only defines
 * an "import" condition, so CJS subpath resolution cannot be used — resolve
 * the package root ESM-style, then walk to dist/cli.js.
 */
function resolveMikrotikCliPath(): string {
  const meta = import.meta as ImportMeta & { resolve?: (specifier: string) => string };
  if (typeof meta.resolve !== "function") {
    throw new Error("import.meta.resolve tidak tersedia; runtime Bun diperlukan.");
  }
  const root = fileURLToPath(meta.resolve("@usex/mikrotik-mcp"));
  // .../@usex/mikrotik-mcp/dist/index.js -> .../@usex/mikrotik-mcp
  const pkgDir = resolve(root, "..", "..");
  const cli = resolve(pkgDir, "dist", "cli.js");
  if (!existsSync(cli)) throw new Error(`mikrotik-mcp CLI tidak ditemukan di ${cli}`);
  return cli;
}
