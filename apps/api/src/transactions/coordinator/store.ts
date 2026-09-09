import { eq } from "drizzle-orm";
import { changeTransactions } from "../../db/schema";
import type { Database } from "../../db";
import { AppError } from "../../lib/errors";
import { ALLOWED_TRANSITIONS, type CoordinatorState, type TxState } from "./types";

export async function requireTx(db: Database, txId: string) {
  const [row] = await db.select().from(changeTransactions).where(eq(changeTransactions.id, txId)).limit(1);
  if (!row) throw new AppError("NOT_FOUND", "Transaksi tidak ditemukan.", 404);
  return row;
}

export async function transitionTx(db: Database, txId: string, next: TxState, extra: Record<string, unknown>): Promise<void> {
  const row = await requireTx(db, txId);
  const current = row.state as TxState;
  if (!ALLOWED_TRANSITIONS[current].includes(next)) {
    throw new AppError(
      "CONFLICT",
      `Transisi transaksi tidak valid: ${current} → ${next}.`,
      409,
    );
  }
  // persist the phase BEFORE any external action tied to it
  await db
    .update(changeTransactions)
    .set({
      state: next,
      updatedAt: new Date(),
      recoveryMetadata: { ...(row.recoveryMetadata ?? {}), lastTransition: next, ...extra },
    })
    .where(eq(changeTransactions.id, txId));
}

export function assertOwner(lockOwner: string | null, userId: string): void {
  if (lockOwner !== userId) {
    throw new AppError("FORBIDDEN", "Transaksi bukan milik sesi ini.", 403);
  }
}

export function cleanupTx(state: CoordinatorState, txId: string, routerIdentity: string): void {
  state.sessions.delete(txId);
  state.actionCount.delete(txId);
  releaseLock(state, routerIdentity, txId);
}

/**
 * Acquire the per-physical-router lock. Different connectors pointing at
 * the same router (host alias) serialize on the verified identity.
 * A live transaction on the router → conflict (409) without revealing
 * which user owns it.
 */
export async function acquireLock(state: CoordinatorState, routerIdentity: string, txId: string): Promise<void> {
  let lock = state.locks.get(routerIdentity);
  if (!lock) {
    lock = { owner: null, waiting: [] };
    state.locks.set(routerIdentity, lock);
  }
  if (lock.owner === txId) return;
  while (lock.owner !== null) {
    await new Promise<void>((resolve) => lock!.waiting.push(resolve));
    lock = state.locks.get(routerIdentity)!;
  }
  lock.owner = txId;
}

export function releaseLock(state: CoordinatorState, routerIdentity: string, txId: string): void {
  const lock = state.locks.get(routerIdentity);
  if (!lock || lock.owner !== txId) return;
  lock.owner = null;
  const next = lock.waiting.shift();
  if (next) next();
  if (!lock.owner && lock.waiting.length === 0) state.locks.delete(routerIdentity);
}
