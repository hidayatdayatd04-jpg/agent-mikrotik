import { auditEvents } from "../../db/schema";
import { assertOwner, cleanupTx, requireTx, transitionTx } from "./store";
import { markUnknown } from "./sessions";
import type { CoordinatorState, TransactionCoordinatorDeps, TxState } from "./types";

/** Commit path: verify → commit; any doubt → rollback or unknown. */
export async function commitTransaction(
  deps: TransactionCoordinatorDeps,
  state: CoordinatorState,
  txId: string,
  userId: string,
): Promise<{ state: TxState }> {
  const row = await requireTx(deps.db, txId);
  assertOwner(row.lockOwner, userId);
  const session = state.sessions.get(txId);
  if (!session) {
    await markUnknown(deps, state, txId, "session hilang saat commit");
    return { state: "unknown" };
  }

  await transitionTx(deps.db, txId, "verifying", { phase: "pre-commit checks" });
  const check = await deps.verifyChecks({
    userId: row.lockOwner ?? "",
    connectionId: row.connectionId,
    routerIdentity: row.routerIdentity ?? "",
  });
  if (!check.ok) {
    deps.logger.warn(`pre-commit check failed for tx ${txId}`, { detail: check.detail });
    return rollbackTransaction(deps, state, txId, userId, { reason: check.detail });
  }

  await transitionTx(deps.db, txId, "committing", { phase: "commit" });
  try {
    await session.commit();
  } catch {
    // commit attempt failed or connection dropped mid-commit: probe, never guess
    const st = await session.status().catch(() => "unknown" as const);
    if (st === "active") {
      // window still open → commit did not happen; roll back
      return rollbackTransaction(deps, state, txId, userId, { reason: "commit gagal; window masih aktif" });
    }
    await markUnknown(deps, state, txId, `commit error; status=${st}`);
    return { state: "unknown" };
  }
  await transitionTx(deps.db, txId, "committed", { phase: "done" });
  cleanupTx(state, txId, row.routerIdentity ?? "");
  await deps.db.insert(auditEvents).values({
    userId,
    action: "transaction.committed",
    connectionId: row.connectionId,
    metadata: { transactionId: txId },
  });
  return { state: "committed" };
}

/** Rollback: requested → verified; controlled recheck before concluding. */
export async function rollbackTransaction(
  deps: TransactionCoordinatorDeps,
  state: CoordinatorState,
  txId: string,
  userId: string,
  meta: { reason: string },
): Promise<{ state: TxState }> {
  const row = await requireTx(deps.db, txId);
  assertOwner(row.lockOwner, userId);
  await transitionTx(deps.db, txId, "rolling_back", { reason: meta.reason });
  const session = state.sessions.get(txId);
  try {
    await session?.rollback();
    // controlled recheck: closing the session auto-reverts; probe the window
    const st = await session?.status().catch(() => "unknown" as const);
    if (st === "active") {
      // window still open — session close did not revert
      await transitionTx(deps.db, txId, "unknown", { reason: "rollback: window masih aktif" });
      return { state: "unknown" };
    }
    await transitionTx(deps.db, txId, "rolled_back", { reason: meta.reason });
    cleanupTx(state, txId, row.routerIdentity ?? "");
    await deps.db.insert(auditEvents).values({
      userId,
      action: "transaction.rolled_back",
      connectionId: row.connectionId,
      metadata: { transactionId: txId, reason: meta.reason },
    });
    return { state: "rolled_back" };
  } catch (err) {
    await markUnknown(deps, state, txId, `rollback error: ${err instanceof Error ? err.message : String(err)}`);
    return { state: "unknown" };
  }
}
