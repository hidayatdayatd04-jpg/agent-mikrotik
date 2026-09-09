import { changeTransactions, auditEvents } from "../../db/schema";
import { AppError } from "../../lib/errors";
import { ensureRouterFree } from "./guards";
import { acquireLock, releaseLock, requireTx, transitionTx } from "./store";
import type { CoordinatorState, SafeModeSession, TransactionCoordinatorDeps, TxState } from "./types";

export interface BeginInput {
  userId: string;
  connectionId: string;
  routerIdentity: string;
  runId: string | null;
  snapshotPlan: { name: string; command: string }[];
}

/** Begin: persist preparing row, take the router lock, enable safe mode. */
export async function beginTransaction(
  deps: TransactionCoordinatorDeps,
  state: CoordinatorState,
  reconcile: (txId: string) => Promise<{ state: TxState }>,
  input: BeginInput,
): Promise<{ transactionId: string }> {
  await ensureRouterFree({ db: deps.db, logger: deps.logger, reconcile }, input.routerIdentity);

  const [row] = await deps.db
    .insert(changeTransactions)
    .values({
      connectionId: input.connectionId,
      routerIdentity: input.routerIdentity,
      runId: input.runId,
      state: "preparing",
      lockOwner: input.userId,
      verification: { snapshotPlan: input.snapshotPlan },
    })
    .returning();

  await acquireLock(state, input.routerIdentity, row!.id);
  try {
    // persist identity + phase BEFORE the external enable call
    await transitionTx(deps.db, row!.id, "active", { phase: "enabling safe mode" });
    let session: SafeModeSession;
    if (deps.openVerifiedSession) {
      // enable + prove the window is live (self-heals a wedged child once)
      session = await deps.openVerifiedSession({
        userId: input.userId,
        connectionId: input.connectionId,
        routerIdentity: input.routerIdentity,
      });
    } else {
      session = await deps.openSession({
        userId: input.userId,
        connectionId: input.connectionId,
        routerIdentity: input.routerIdentity,
      });
      // openSession only binds the child — the window must be enabled explicitly
      await session.enable();
    }
    const st = await session.status();
    if (st !== "active") {
      releaseLock(state, input.routerIdentity, row!.id);
      await transitionTx(deps.db, row!.id, "unknown", { reason: `safe mode status=${st} setelah enable` });
      throw new AppError("SAFE_MODE_UNAVAILABLE", "Safe Mode tidak aktif setelah enable; transaksi ditandai unknown.", 409);
    }
    (state.sessions).set(row!.id, session);
    await deps.db.insert(auditEvents).values({
      userId: input.userId,
      action: "transaction.begun",
      connectionId: input.connectionId,
      metadata: { transactionId: row!.id, routerIdentity: input.routerIdentity },
    });
    return { transactionId: row!.id };
  } catch (err) {
    // A failed begin must not leave a live ("active") orphan row blocking
    // the router: an explicit enable refusal means no window was opened
    // (close as rolled_back), anything else leaves the window state in
    // doubt (unknown). Bookkeeping never masks the original error.
    try {
      const current = await requireTx(deps.db, row!.id);
      if (current.state === "active") {
        if (err instanceof AppError) {
          await transitionTx(deps.db, row!.id, "rolling_back", { reason: err.message });
          await transitionTx(deps.db, row!.id, "rolled_back", { reason: err.message });
        } else {
          await transitionTx(deps.db, row!.id, "unknown", { reason: err instanceof Error ? err.message : String(err) });
        }
      }
    } catch {
      /* ignore bookkeeping errors */
    }
    releaseLock(state, input.routerIdentity, row!.id);
    throw err;
  }
}
