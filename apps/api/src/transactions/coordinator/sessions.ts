import { AppError } from "../../lib/errors";
import { releaseLock, requireTx, transitionTx } from "./store";
import type { CoordinatorState, SafeModeSession, TransactionCoordinatorDeps } from "./types";
import { assertOwner } from "./store";

export function getSession(state: CoordinatorState, txId: string): SafeModeSession | null {
  return state.sessions.get(txId) ?? null;
}

export function recordAction(deps: TransactionCoordinatorDeps, state: CoordinatorState, txId: string): void {
  const n = (state.actionCount.get(txId) ?? 0) + 1;
  if (n > deps.maxActionsPerTransaction) {
    throw new AppError("VALIDATION_FAILED", `Batas aksi RouterOS per transaksi (${deps.maxActionsPerTransaction}) terlampaui.`, 400);
  }
  state.actionCount.set(txId, n);
}

export function getActionCount(state: CoordinatorState, txId: string): number {
  return state.actionCount.get(txId) ?? 0;
}

/** State unknown releases the in-process lock but stays on the books until reconciled. */
export async function markUnknown(
  deps: TransactionCoordinatorDeps,
  state: CoordinatorState,
  txId: string,
  reason: string,
): Promise<void> {
  const row = await requireTx(deps.db, txId);
  if (row.state === "unknown") {
    await transitionTx(deps.db, txId, "unknown", { reason });
    return;
  }
  await transitionTx(deps.db, txId, "unknown", { reason });
  state.sessions.delete(txId);
  releaseLock(state, row.routerIdentity ?? "", txId);
}

export async function execInSession(
  deps: TransactionCoordinatorDeps,
  state: CoordinatorState,
  txId: string,
  userId: string,
  command: string,
): Promise<{ output: string }> {
  const row = await requireTx(deps.db, txId);
  assertOwner(row.lockOwner, userId);
  await assertActive(deps, state, txId);
  const session = state.sessions.get(txId);
  if (!session || !session.exec) {
    throw new AppError("SAFE_MODE_UNAVAILABLE", "Sesi safe mode tidak mendukung eksekusi command langsung.", 500);
  }
  const res = await session.exec(command);
  recordAction(deps, state, txId);
  return res;
}

/** Before every mutation batch: is the session still alive + safe mode open? */
export async function assertActive(
  deps: TransactionCoordinatorDeps,
  state: CoordinatorState,
  txId: string,
): Promise<void> {
  const row = await requireTx(deps.db, txId);
  if (row.state !== "active" && row.state !== "verifying") {
    throw new AppError("SAFE_MODE_UNAVAILABLE", `Transaksi ${row.state} — mutasi baru ditolak.`, 409);
  }
  const session = state.sessions.get(txId);
  if (!session) {
    await markUnknown(deps, state, txId, "session hilang");
    throw new AppError("SAFE_MODE_UNAVAILABLE", "Sesi Safe Mode tidak ditemukan; transaksi unknown.", 409);
  }
  const st = await session.status();
  if (st !== "active") {
    await markUnknown(deps, state, txId, `safe mode status=${st} sebelum mutasi`);
    throw new AppError("SAFE_MODE_UNAVAILABLE", "Sesi Safe Mode tertutup; transaksi unknown — lakukan reconciliasi.", 409);
  }
}
