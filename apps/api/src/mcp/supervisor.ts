import type { Logger } from "../lib/logger";
import { ChildRegistry, spawnChildProcess } from "./supervisor-registry";
import type { ConnectionSpec, McpChild, SpawnPlan, SupervisorLimits } from "./supervisor-types";

export type { ConnectionSpec, McpChild, SpawnPlan, SupervisedEntry, SupervisorLimits } from "./supervisor-types";
export { McpSpawnError } from "./supervisor-types";

/**
 * Spawns mikrotik-mcp child processes with a minimal, connection-scoped env.
 * Never inherits the application's process.env: only the MIKROTIK_* variables
 * for this connection plus a fixed safe baseline.
 */
export class McpSupervisor {
  private registry: ChildRegistry;
  private starting = new Map<string, Promise<McpChild>>();

  constructor(
    private plan: (spec: ConnectionSpec) => SpawnPlan,
    private limits: SupervisorLimits,
    private logger: Logger,
  ) {
    this.registry = new ChildRegistry(limits, logger, (userId, connId) => {
      void this.stop(userId, connId);
    });
  }

  async getOrSpawn(spec: ConnectionSpec): Promise<McpChild> {
    const key = this.registry.key(spec);
    const pending = this.starting.get(key);
    if (pending) {
      const child = await pending;
      if (child.spec.readOnly === spec.readOnly) return child;
      return this.getOrSpawn(spec);
    }
    const operation = this.spawnOrReuse(spec);
    this.starting.set(key, operation);
    try {
      return await operation;
    } finally {
      if (this.starting.get(key) === operation) this.starting.delete(key);
    }
  }

  private async spawnOrReuse(spec: ConnectionSpec): Promise<McpChild> {
    const key = this.registry.key(spec);
    const existing = this.registry.get(key);
    if (existing) {
      if (existing.dead) {
        // crashed child: drop the entry and respawn below
        await this.stop(spec.userId, spec.connectionId);
      } else if (existing.child.spec.readOnly !== spec.readOnly) {
        // Mode change requires a fresh process: old one has a different tool registration.
        await this.stop(spec.userId, spec.connectionId);
      } else {
        existing.child.lastUsedAt = Date.now();
        this.registry.resetIdleTimer(key);
        return existing.child;
      }
    }

    this.registry.enforceLimits(spec.userId, key, [...this.starting.keys()]);

    const child = await spawnChildProcess(this.plan, spec, this.limits.startupTimeoutMs, this.logger);
    const entry = { child, idleTimer: null as ReturnType<typeof setTimeout> | null, dead: false };
    this.registry.set(key, entry, spec.userId);

    // Crash handling: if the child dies unexpectedly, mark the entry dead so the
    // next getOrSpawn spawns a fresh one; no unbounded auto-restart while a
    // transaction might be in flight (M6 owns transactional recovery).
    // Preserve SDK transport callbacks: they reject pending requests on close.
    child.client.onclose = () => {
      this.registry.markDeadIfCurrent(key, entry, `mcp child crashed for ${key}; entry marked dead`);
    };
    child.client.onerror = (err) => {
      this.registry.markDeadIfCurrent(key, entry, `mcp child transport error for ${key}`, {
        error: err instanceof Error ? err.message : String(err),
      });
    };

    this.logger.info(`mcp child up for ${key}`, { readOnly: spec.readOnly });
    return child;
  }

  async stop(userId: string, connectionId: string): Promise<void> {
    const entry = await this.registry.remove(userId, connectionId);
    if (!entry) return;
    const key = `${userId}:${connectionId}`;
    await entry.child.stop().catch((err: unknown) => {
      this.logger.warn(`mcp child stop error for ${key}`, {
        error: err instanceof Error ? err.message : String(err),
      });
    });
    this.logger.info(`mcp child stopped for ${key}`);
  }

  getActive(userId: string): string[] {
    return this.registry.getActive(userId);
  }

  async stopAllForUser(userId: string): Promise<void> {
    const ids = this.getActive(userId);
    for (const id of ids) await this.stop(userId, id);
  }

  async shutdownAll(): Promise<void> {
    for (const key of [...this.registry.keys()]) {
      const [userId, connId] = key.split(":");
      if (userId && connId) await this.stop(userId, connId);
    }
  }

  count(): number {
    return this.registry.count();
  }
}
