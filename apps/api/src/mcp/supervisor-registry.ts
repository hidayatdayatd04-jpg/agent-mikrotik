import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { Logger } from "../lib/logger";
import { McpSpawnError, type ConnectionSpec, type McpChild, type SpawnPlan, type SupervisedEntry, type SupervisorLimits } from "./supervisor-types";

/** Registry anak MCP: batas, idle timer, stop, hitung — tanpa logika spawn. */
export class ChildRegistry {
  private children = new Map<string, SupervisedEntry>();
  private userCounts = new Map<string, number>();

  constructor(
    private limits: SupervisorLimits,
    private logger: Logger,
    private onIdleTimeout: (userId: string, connectionId: string) => void,
  ) {}

  key(spec: { userId: string; connectionId: string }) {
    return `${spec.userId}:${spec.connectionId}`;
  }

  get(key: string): SupervisedEntry | undefined {
    return this.children.get(key);
  }

  set(key: string, entry: SupervisedEntry, userId: string): void {
    this.children.set(key, entry);
    this.userCounts.set(userId, (this.userCounts.get(userId) ?? 0) + 1);
    this.resetIdleTimer(key);
  }

  keys(): Iterable<string> {
    return this.children.keys();
  }

  count(): number {
    return this.children.size;
  }

  getActive(userId: string): string[] {
    return [...this.children.keys()].filter((k) => k.startsWith(`${userId}:`)).map((k) => k.split(":")[1]!);
  }

  async remove(userId: string, connectionId: string): Promise<SupervisedEntry | undefined> {
    const key = `${userId}:${connectionId}`;
    const entry = this.children.get(key);
    if (!entry) return undefined;
    this.clearIdleTimer(key);
    this.children.delete(key);
    const n = (this.userCounts.get(userId) ?? 1) - 1;
    if (n <= 0) this.userCounts.delete(userId);
    else this.userCounts.set(userId, n);
    return entry;
  }

  enforceLimits(userId: string, currentKey: string, startingKeys: string[]) {
    const pending = startingKeys.filter((key) => key !== currentKey && !this.children.has(key));
    if (this.children.size + pending.length >= this.limits.total) {
      throw new McpSpawnError("Batas total proses MCP tercapai. Coba lagi nanti.", "");
    }
    if ((this.userCounts.get(userId) ?? 0) + pending.filter((key) => key.startsWith(`${userId}:`)).length >= this.limits.maxPerUser) {
      throw new McpSpawnError("Batas proses MCP per user tercapai untuk koneksi ini.", "");
    }
  }

  resetIdleTimer(key: string) {
    const entry = this.children.get(key);
    if (!entry) return;
    this.clearIdleTimer(key);
    entry.idleTimer = setTimeout(() => {
      const [userId, connId] = key.split(":");
      if (userId && connId) {
        this.logger.info(`mcp idle timeout: closing ${key}`);
        this.onIdleTimeout(userId, connId);
      }
    }, this.limits.idleTimeoutMs);
    entry.idleTimer.unref?.();
  }

  clearIdleTimer(key: string) {
    const entry = this.children.get(key);
    if (entry?.idleTimer) {
      clearTimeout(entry.idleTimer);
      entry.idleTimer = null;
    }
  }

  markDeadIfCurrent(key: string, entry: SupervisedEntry, reason: string, detail?: Record<string, unknown>): void {
    if (this.children.get(key) === entry && !entry.dead) {
      entry.dead = true;
      this.logger.warn(reason, detail);
    }
  }
}

/** Bootstrap transport+client untuk satu child baru (tanpa registrasi). */
export async function spawnChildProcess(
  plan: (spec: ConnectionSpec) => SpawnPlan,
  spec: ConnectionSpec,
  startupTimeoutMs: number,
  logger: Logger,
): Promise<McpChild> {
  const p = plan(spec);
  const transport = new StdioClientTransport({
    command: p.command,
    args: p.args,
    env: p.env,
    cwd: p.cwd,
    stderr: "pipe",
  });
  const stderrLines: string[] = [];
  transport.stderr?.on("data", (chunk: Buffer) => {
    const line = chunk.toString().trim();
    if (line) stderrLines.push(line);
    if (stderrLines.length > 200) stderrLines.shift();
  });

  const client = new Client({ name: "agent-mikrotik-backend", version: "0.1.0" });
  const connect = client.connect(transport);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("MCP startup timeout")), startupTimeoutMs);
  });
  const key = `${spec.userId}:${spec.connectionId}`;
  try {
    await Promise.race([connect, timeout]);
  } catch (err) {
    await client.close().catch(() => {});
    const tail = stderrLines.slice(-10).join("\n");
    logger.warn(`mcp spawn failed for ${key}`, { error: err instanceof Error ? err.message : String(err), stderrTail: tail });
    throw new McpSpawnError(err instanceof Error ? err.message : "spawn failed", tail);
  } finally {
    clearTimeout(timer);
  }

  return {
    client,
    transport,
    spawnedAt: Date.now(),
    lastUsedAt: Date.now(),
    spec,
    stop: async () => {
      await client.close().catch(() => {});
    },
  };
}
