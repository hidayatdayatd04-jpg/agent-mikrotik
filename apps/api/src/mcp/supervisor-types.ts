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
  client: import("@modelcontextprotocol/sdk/client/index.js").Client;
  transport: import("@modelcontextprotocol/sdk/client/stdio.js").StdioClientTransport;
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

export interface SupervisedEntry {
  child: McpChild;
  idleTimer: ReturnType<typeof setTimeout> | null;
  dead: boolean;
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
