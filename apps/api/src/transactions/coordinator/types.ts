import type { Database } from "../../db";
import type { Logger } from "../../lib/logger";

export type TxState =
  | "preparing"
  | "active"
  | "verifying"
  | "committing"
  | "committed"
  | "rolling_back"
  | "rolled_back"
  | "unknown";

export const ALLOWED_TRANSITIONS: Record<TxState, TxState[]> = {
  preparing: ["active", "rolling_back", "rolled_back", "unknown"],
  active: ["verifying", "rolling_back", "unknown"],
  verifying: ["committing", "rolling_back", "unknown"],
  committing: ["committed", "rolling_back", "unknown"],
  rolling_back: ["rolled_back", "unknown"],
  committed: [],
  rolled_back: [],
  // unknown may only exit via reconciliation closing the books; never to committed
  unknown: ["unknown", "rolled_back"],
};

export interface SafeModeSession {
  enable(): Promise<void>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
  /** probe: is the safe-mode window still open? */
  status(): Promise<"active" | "closed" | "unknown">;
  /** executes a command within the safe-mode session */
  exec?(command: string): Promise<{ output: string }>;
}

/** Connection context the session opener needs to bind a child MCP process. */
export interface TransactionContext {
  userId: string;
  connectionId: string;
  routerIdentity: string;
}

export interface TransactionCoordinatorDeps {
  db: Database;
  logger: Logger;
  /** opens (or reuses) the safe-mode session bound to one child SSH connection */
  openSession(ctx: TransactionContext): Promise<SafeModeSession>;
  /**
   * Preferred opener: enable + prove liveness, recycling a wedged child once.
   * When absent, begin falls back to openSession + enable (legacy behavior).
   */
  openVerifiedSession?(ctx: TransactionContext): Promise<SafeModeSession>;
  /** read-only checks executed before commit; must not contain secrets */
  verifyChecks(ctx: TransactionContext): Promise<{ ok: boolean; detail: string }>;
  /** hard cap on RouterOS actions per transaction (not just tool calls) */
  maxActionsPerTransaction: number;
}

export interface RouterLock {
  owner: string | null; // transaction id
  waiting: (() => void)[];
}

/** State koordinator bersama (pengganti field privat class). */
export interface CoordinatorState {
  locks: Map<string, RouterLock>;
  sessions: Map<string, SafeModeSession>;
  actionCount: Map<string, number>;
}

export function createCoordinatorState(): CoordinatorState {
  return { locks: new Map(), sessions: new Map(), actionCount: new Map() };
}
