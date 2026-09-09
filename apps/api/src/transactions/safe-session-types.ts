import type { TransactionContext } from "./coordinator";
import type { McpSupervisor } from "../mcp/supervisor";
import type { McpChild } from "../mcp/supervisor";
import type { Logger } from "../lib/logger";

export interface SafeModeSessionContext {
  userId: string;
  connectionId: string;
  spec: {
    host: string;
    port: number;
    username: string;
    password: string | null;
    hostKeyFingerprint: string | null;
  };
}

export interface SafeModeSessionFactoryDeps {
  supervisor: McpSupervisor;
  logger: Logger;
  /** fetch connector context incl. decrypted credentials; reuse the connector service */
  getConnection: (userId: string, connectionId: string) => Promise<SafeModeSessionContext>;
  /** liveness probe budget per attempt (ms). Default 25_000. */
  probeTimeoutMs?: number;
}

/** State factory bersama: child cache + helper key/timeout. */
export interface SafeSessionState {
  deps: SafeModeSessionFactoryDeps;
  children: Map<string, McpChild>;
  probeTimeoutMs: number;
}

export function sessionKey(userId: string, connectionId: string) {
  return `${userId}:${connectionId}`;
}

export function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return new Promise<T>((resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms}ms`)), ms);
    p.then(
      (v) => { if (timer) clearTimeout(timer); resolve(v); },
      (e) => { if (timer) clearTimeout(timer); reject(e); },
    );
  });
}

export type { TransactionContext };
