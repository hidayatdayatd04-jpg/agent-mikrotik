import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { Logger } from "../lib/logger";

export interface ConnectionSpec {
  connectionId: string;
  userId: string;
  host: string;
  port: number;
  username: string;
  password: string | null;
  hostKeyFingerprint: string | null;
  readOnly: boolean;
}

export interface SpawnPlan {
  command: string;
  args: string[];
  env: Record<string, string>;
  /** Isolated working directory for this child; supervisor removes it on stop. */
  cwd: string;
}

export interface McpChild {
  client: Client;
  transport: StdioClientTransport;
  spawnedAt: number;
  lastUsedAt: number;
  spec: ConnectionSpec;
  stop(): Promise<void>;
}

export interface SupervisorLimits {
  maxPerUser: number;
  total: number;
  idleTimeoutMs: number;
  startupTimeoutMs: number;
}

interface SupervisedEntry {
  child: McpChild;
  idleTimer: ReturnType<typeof setTimeout> | null;
  dead: boolean;
}

/**
 * Spawns mikrotik-mcp child processes with a minimal, connection-scoped env.
 * Never inherits the application's process.env: only the MIKROTIK_* variables
 * for this connection plus a fixed safe baseline.
 */
export class McpSupervisor {
  private children = new Map<string, SupervisedEntry>();
  private userCounts = new Map<string, number>();
  private sweeper: ReturnType<typeof setInterval> | null = null;

  constructor(
    private plan: (spec: ConnectionSpec) => SpawnPlan,
    private limits: SupervisorLimits,
    private logger: Logger,
  ) {}

  private key(spec: { userId: string; connectionId: string }) {
    return `${spec.userId}:${spec.connectionId}`;
  }

  async getOrSpawn(spec: ConnectionSpec): Promise<McpChild> {
    const key = this.key(spec);
    const existing = this.children.get(key);
    if (existing) {
      if (existing.dead) {
        // crashed child: drop the entry and respawn below
        await this.stop(spec.userId, spec.connectionId);
      } else if (existing.child.spec.readOnly !== spec.readOnly) {
        // Mode change requires a fresh process: old one has a different tool registration.
        await this.stop(spec.userId, spec.connectionId);
      } else {
        existing.child.lastUsedAt = Date.now();
        this.resetIdleTimer(key);
        return existing.child;
      }
    }

    this.enforceLimits(spec.userId);

    const p = this.plan(spec);
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
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("MCP startup timeout")), this.limits.startupTimeoutMs),
    );
    try {
      await Promise.race([connect, timeout]);
    } catch (err) {
      await client.close().catch(() => {});
      const tail = stderrLines.slice(-10).join("\n");
      this.logger.warn(`mcp spawn failed for ${key}`, { error: err instanceof Error ? err.message : String(err), stderrTail: tail });
      throw new McpSpawnError(err instanceof Error ? err.message : "spawn failed", tail);
    }

    const child: McpChild = {
      client,
      transport,
      spawnedAt: Date.now(),
      lastUsedAt: Date.now(),
      spec,
      stop: async () => {
        await client.close().catch(() => {});
      },
    };
    const entry: SupervisedEntry = { child, idleTimer: null, dead: false };
    this.children.set(key, entry);

    // Crash handling: if the child dies unexpectedly, mark the entry dead so the
    // next getOrSpawn spawns a fresh one; no unbounded auto-restart while a
    // transaction might be in flight (M6 owns transactional recovery).
    transport.onclose = () => {
      if (this.children.get(key) === entry && !entry.dead) {
        entry.dead = true;
        this.logger.warn(`mcp child crashed for ${key}; entry marked dead`);
      }
    };
    transport.onerror = (err) => {
      if (this.children.get(key) === entry && !entry.dead) {
        entry.dead = true;
        this.logger.warn(`mcp child transport error for ${key}`, {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    };

    this.userCounts.set(spec.userId, (this.userCounts.get(spec.userId) ?? 0) + 1);
    this.resetIdleTimer(key);
    this.logger.info(`mcp child up for ${key}`, { readOnly: spec.readOnly });
    return child;
  }

  async stop(userId: string, connectionId: string): Promise<void> {
    const key = `${userId}:${connectionId}`;
    const entry = this.children.get(key);
    if (!entry) return;
    this.clearIdleTimer(key);
    this.children.delete(key);
    const n = (this.userCounts.get(userId) ?? 1) - 1;
    if (n <= 0) this.userCounts.delete(userId);
    else this.userCounts.set(userId, n);
    await entry.child.stop().catch((err: unknown) => {
      this.logger.warn(`mcp child stop error for ${key}`, {
        error: err instanceof Error ? err.message : String(err),
      });
    });
    this.logger.info(`mcp child stopped for ${key}`);
  }

  getActive(userId: string): string[] {
    return [...this.children.keys()].filter((k) => k.startsWith(`${userId}:`)).map((k) => k.split(":")[1]!);
  }

  async stopAllForUser(userId: string): Promise<void> {
    const ids = this.getActive(userId);
    for (const id of ids) await this.stop(userId, id);
  }

  async shutdownAll(): Promise<void> {
    for (const key of [...this.children.keys()]) {
      const [userId, connId] = key.split(":");
      if (userId && connId) await this.stop(userId, connId);
    }
  }

  count(): number {
    return this.children.size;
  }

  private enforceLimits(userId: string) {
    if (this.children.size >= this.limits.total) {
      throw new McpSpawnError("Batas total proses MCP tercapai. Coba lagi nanti.", "");
    }
    if ((this.userCounts.get(userId) ?? 0) >= this.limits.maxPerUser) {
      throw new McpSpawnError("Batas proses MCP per user tercapai untuk koneksi ini.", "");
    }
  }

  private resetIdleTimer(key: string) {
    const entry = this.children.get(key);
    if (!entry) return;
    this.clearIdleTimer(key);
    entry.idleTimer = setTimeout(() => {
      const [userId, connId] = key.split(":");
      if (userId && connId) {
        this.logger.info(`mcp idle timeout: closing ${key}`);
        void this.stop(userId, connId);
      }
    }, this.limits.idleTimeoutMs);
    entry.idleTimer.unref?.();
  }

  private clearIdleTimer(key: string) {
    const entry = this.children.get(key);
    if (entry?.idleTimer) {
      clearTimeout(entry.idleTimer);
      entry.idleTimer = null;
    }
  }
}

export class McpSpawnError extends Error {
  constructor(
    message: string,
    readonly stderrTail: string,
  ) {
    super(message);
    this.name = "McpSpawnError";
  }
}
