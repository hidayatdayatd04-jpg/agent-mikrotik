import { eq } from "drizzle-orm";
import { changeTransactions } from "../db/schema";
import { beginTransaction, type BeginInput } from "./coordinator/begin";
import { commitTransaction, rollbackTransaction } from "./coordinator/finish";
import { reconcileOrphans, reconcileTransaction } from "./coordinator/reconcile";
import { assertActive, execInSession, getActionCount, getSession, recordAction } from "./coordinator/sessions";
import { createCoordinatorState, type CoordinatorState, type SafeModeSession, type TransactionCoordinatorDeps, type TxState } from "./coordinator/types";

export type {
  SafeModeSession,
  TransactionContext,
  TransactionCoordinatorDeps,
  TxState,
} from "./coordinator/types";

/**
 * Backend transaction coordinator for RouterOS Safe Mode.
 *
 * State machine: preparing → active → verifying → committing → committed
 *                failing → rolling_back → rolled_back
 *                any → unknown (drop/crash detection; never success)
 *
 * The MODEL never drives commit/rollback decisions: enable/commit/rollback
 * safe-mode tools are policy-gated, and this coordinator is the only writer
 * of transaction state. Mutations are serialized per physical router
 * (verified router identity, not host alias) via an in-process lock map;
 * cross-process serialization is provided by the DB row state + lock owner.
 */
export class TransactionCoordinator {
  private state: CoordinatorState = createCoordinatorState();

  constructor(private deps: TransactionCoordinatorDeps) {}

  /** Begin: persist preparing row, take the router lock, enable safe mode. */
  async begin(input: BeginInput): Promise<{ transactionId: string }> {
    return beginTransaction(this.deps, this.state, (txId) => this.reconcile(txId), input);
  }

  getSession(txId: string): SafeModeSession | null {
    return getSession(this.state, txId);
  }

  recordAction(txId: string): void {
    recordAction(this.deps, this.state, txId);
  }

  getActionCount(txId: string): number {
    return getActionCount(this.state, txId);
  }

  async execInSession(txId: string, userId: string, command: string): Promise<{ output: string }> {
    return execInSession(this.deps, this.state, txId, userId, command);
  }

  /** Before every mutation batch: is the session still alive + safe mode open? */
  async assertActive(txId: string): Promise<void> {
    return assertActive(this.deps, this.state, txId);
  }

  /** Commit path: verify → commit; any doubt → rollback or unknown. */
  async commit(txId: string, userId: string): Promise<{ state: TxState }> {
    return commitTransaction(this.deps, this.state, txId, userId);
  }

  /** Rollback: requested → verified; controlled recheck before concluding. */
  async rollback(txId: string, userId: string, meta: { reason: string }): Promise<{ state: TxState }> {
    return rollbackTransaction(this.deps, this.state, txId, userId, meta);
  }

  /**
   * Reconciliation after crash/drop: read the router's current safe-mode state
   * and close the books. NEVER replays mutations.
   */
  async reconcile(txId: string, opts?: { resolveOrphan?: boolean }): Promise<{ state: TxState }> {
    return reconcileTransaction(this.deps, this.state, txId, opts);
  }

  /**
   * Reconciles all pending 'unknown' transactions across the database on startup.
   */
  async reconcileOrphans(): Promise<number> {
    return reconcileOrphans(this.deps, this.state);
  }

  /**
   * Backend-internal cleanup after Write revoked / disconnect / logout.
   * NOT callable by the model — no policy path exposes this.
   */
  async forceRollback(txId: string, userId: string): Promise<{ state: TxState }> {
    return this.rollback(txId, userId, { reason: "cleanup backend: Write dicabut/disconnect" });
  }

  async activeTransactionsForRouter(routerIdentity: string) {
    const rows = await this.deps.db
      .select()
      .from(changeTransactions)
      .where(eq(changeTransactions.routerIdentity, routerIdentity));
    const activeStates: TxState[] = ["preparing", "active", "verifying", "committing", "rolling_back", "unknown"];
    return rows.filter((r) => activeStates.includes(r.state as TxState));
  }
}
