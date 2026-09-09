import { and, eq, inArray } from "drizzle-orm";
import { changeTransactions } from "../../db/schema";
import type { Database } from "../../db";
import type { Logger } from "../../lib/logger";
import { AppError } from "../../lib/errors";
import type { TxState } from "./types";

export interface GuardDeps {
  db: Database;
  logger: Logger;
  reconcile: (txId: string) => Promise<{ state: TxState }>;
}

/**
 * Guard pra-begin: tolak bila ada transaksi live; rekonsiliasi unknown yang
 * bisa diselamatkan; tolak bila unknown tak terreconciliasi masih tersisa.
 */
export async function ensureRouterFree(deps: GuardDeps, routerIdentity: string): Promise<void> {
  // conflict check before spending a lock wait: any live tx on this router?
  const activeStates: TxState[] = ["preparing", "active", "verifying", "committing", "rolling_back"];
  const live = await deps.db
    .select()
    .from(changeTransactions)
    .where(
      and(
        eq(changeTransactions.routerIdentity, routerIdentity),
        inArray(changeTransactions.state, activeStates),
      ),
    )
    .limit(1);
  if (live.length > 0) {
    throw new AppError(
      "SAFE_MODE_UNAVAILABLE",
      "Safe Mode router ini sedang dipakai transaksi lain. Tunggu hingga selesai atau putuskan dari panel.",
      409,
    );
  }
  // an unreconciled unknown tx means the safe-mode window state is unknown:
  // refuse new transactions on this router until reconciliation closes the books.
  // Best effort first: reconcile resolvable unknowns (live session in this
  // process) so a stale row doesn't block the router forever.
  let unknowns = await deps.db
    .select()
    .from(changeTransactions)
    .where(
      and(
        eq(changeTransactions.routerIdentity, routerIdentity),
        eq(changeTransactions.state, "unknown"),
      ),
    )
    .limit(5);
  for (const tx of unknowns) {
    try {
      await deps.reconcile(tx.id);
    } catch (err) {
      deps.logger.warn("auto-reconcile before begin failed", { transactionId: tx.id, error: err instanceof Error ? err.message : String(err) });
    }
  }
  if (unknowns.length > 0) {
    unknowns = await deps.db
      .select()
      .from(changeTransactions)
      .where(
        and(
          eq(changeTransactions.routerIdentity, routerIdentity),
          eq(changeTransactions.state, "unknown"),
        ),
      )
      .limit(1);
  }
  if (unknowns.length > 0) {
    throw new AppError(
      "SAFE_MODE_UNAVAILABLE",
      "Terdapat transaksi dengan status tidak diketahui pada router ini. Sambungkan ulang router atau jalankan reconciliasi sebelum memulai transaksi baru.",
      409,
    );
  }
}
