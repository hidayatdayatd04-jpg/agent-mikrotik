import { eq } from "drizzle-orm";
import { changeTransactions } from "../../db/schema";
import { cleanupTx, requireTx, transitionTx } from "./store";
import type { CoordinatorState, TransactionCoordinatorDeps, TxState } from "./types";

/**
 * Reconciliation after crash/drop: read the router's current safe-mode state
 * and close the books. NEVER replays mutations.
 */
export async function reconcileTransaction(
  deps: TransactionCoordinatorDeps,
  state: CoordinatorState,
  txId: string,
  opts?: { resolveOrphan?: boolean },
): Promise<{ state: TxState }> {
  const row = await requireTx(deps.db, txId);
  if (row.state === "committed" || row.state === "rolled_back") return { state: row.state as TxState };
  const session = state.sessions.get(txId) ?? null;
  let st: "active" | "closed" | "unknown" = session ? await session.status().catch(() => "unknown" as const) : "unknown";
  if (st === "unknown" && !session && opts?.resolveOrphan && deps.verifyChecks && row.connectionId) {
    try {
      const check = await deps.verifyChecks({ userId: row.lockOwner ?? "system", connectionId: row.connectionId, routerIdentity: row.routerIdentity ?? "" });
      if (check.ok) {
        // The router is live and verified healthy.
        // Since the previous SSH session died with the crashing process,
        // RouterOS auto-reverted any uncommitted safe-mode changes.
        st = "closed";
      }
    } catch {
      st = "unknown";
    }
  }
  if (st === "active" && session) {
    // a safe-mode window survived: changes are staged but NOT committed —
    // the safe outcome is rollback, and only the backend may do it
    try {
      await session.rollback();
      await transitionTx(deps.db, txId, "rolled_back", { reason: "reconciled: window masih aktif → rollback" });
    } catch {
      await transitionTx(deps.db, txId, "unknown", { reason: "reconcile rollback gagal" });
    }
  } else if (st === "closed") {
    // window closed without our commit → auto-revert happened
    await transitionTx(deps.db, txId, "rolled_back", { reason: "reconciled: window tertutup (auto-revert)" });
  } else {
    // unknown row state may re-reconcile later; never claim committed
    await transitionTx(deps.db, txId, "unknown", { reason: "reconcile: status tidak terbaca" });
  }
  cleanupTx(state, txId, row.routerIdentity ?? "");
  return { state: (await requireTx(deps.db, txId)).state as TxState };
}

/**
 * Reconciles all pending 'unknown' transactions across the database on startup.
 */
export async function reconcileOrphans(
  deps: TransactionCoordinatorDeps,
  state: CoordinatorState,
  onError?: (id: string, err: unknown) => void,
): Promise<number> {
  const rows = await deps.db
    .select({ id: changeTransactions.id })
    .from(changeTransactions)
    .where(eq(changeTransactions.state, "unknown"))
    .limit(25);
  let resolved = 0;
  for (const row of rows) {
    try {
      const res = await reconcileTransaction(deps, state, row.id, { resolveOrphan: true });
      if (res.state === "rolled_back" || res.state === "committed") resolved++;
    } catch (err) {
      if (onError) onError(row.id, err);
      else deps.logger.warn("startup reconcile failed for tx", { id: row.id, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return resolved;
}
