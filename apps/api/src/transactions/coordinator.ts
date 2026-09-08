import { and, eq, inArray } from "drizzle-orm";
import { changeTransactions, auditEvents } from "../db/schema";
import type { Database } from "../db";
import { AppError } from "../lib/errors";
import type { Logger } from "../lib/logger";

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

export type TxState =
  | "preparing"
  | "active"
  | "verifying"
  | "committing"
  | "committed"
  | "rolling_back"
  | "rolled_back"
  | "unknown";

const ALLOWED_TRANSITIONS: Record<TxState, TxState[]> = {
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

interface RouterLock {
  owner: string | null; // transaction id
  waiting: (() => void)[];
}

export class TransactionCoordinator {
  private locks = new Map<string, RouterLock>();
  private sessions = new Map<string, SafeModeSession>();
  private actionCount = new Map<string, number>();

  constructor(private deps: TransactionCoordinatorDeps) {}

  /**
   * Acquire the per-physical-router lock. Different connectors pointing at
   * the same router (host alias) serialize on the verified identity.
   * A live transaction on the router → conflict (409) without revealing
   * which user owns it.
   */
  private async acquire(routerIdentity: string, txId: string): Promise<void> {
    let lock = this.locks.get(routerIdentity);
    if (!lock) {
      lock = { owner: null, waiting: [] };
      this.locks.set(routerIdentity, lock);
    }
    if (lock.owner === txId) return;
    while (lock.owner !== null) {
      await new Promise<void>((resolve) => lock!.waiting.push(resolve));
      lock = this.locks.get(routerIdentity)!;
    }
    lock.owner = txId;
  }

  private release(routerIdentity: string, txId: string): void {
    const lock = this.locks.get(routerIdentity);
    if (!lock || lock.owner !== txId) return;
    lock.owner = null;
    const next = lock.waiting.shift();
    if (next) next();
    if (!lock.owner && lock.waiting.length === 0) this.locks.delete(routerIdentity);
  }

  /** Begin: persist preparing row, take the router lock, enable safe mode. */
  async begin(input: {
    userId: string;
    connectionId: string;
    routerIdentity: string;
    runId: string | null;
    snapshotPlan: { name: string; command: string }[];
  }): Promise<{ transactionId: string }> {
    // conflict check before spending a lock wait: any live tx on this router?
    const activeStates: TxState[] = ["preparing", "active", "verifying", "committing", "rolling_back"];
    const live = await this.deps.db
      .select()
      .from(changeTransactions)
      .where(
        and(
          eq(changeTransactions.routerIdentity, input.routerIdentity),
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
    let unknowns = await this.deps.db
      .select()
      .from(changeTransactions)
      .where(
        and(
          eq(changeTransactions.routerIdentity, input.routerIdentity),
          eq(changeTransactions.state, "unknown"),
        ),
      )
      .limit(5);
    for (const tx of unknowns) {
      try {
        await this.reconcile(tx.id);
      } catch (err) {
        this.deps.logger.warn("auto-reconcile before begin failed", { transactionId: tx.id, error: err instanceof Error ? err.message : String(err) });
      }
    }
    if (unknowns.length > 0) {
      unknowns = await this.deps.db
        .select()
        .from(changeTransactions)
        .where(
          and(
            eq(changeTransactions.routerIdentity, input.routerIdentity),
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

    const [row] = await this.deps.db
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

    await this.acquire(input.routerIdentity, row!.id);
    try {
      // persist identity + phase BEFORE the external enable call
      await this.transition(row!.id, "active", { phase: "enabling safe mode" });
      let session: SafeModeSession;
      if (this.deps.openVerifiedSession) {
        // enable + prove the window is live (self-heals a wedged child once)
        session = await this.deps.openVerifiedSession({
          userId: input.userId,
          connectionId: input.connectionId,
          routerIdentity: input.routerIdentity,
        });
      } else {
        session = await this.deps.openSession({
          userId: input.userId,
          connectionId: input.connectionId,
          routerIdentity: input.routerIdentity,
        });
        // openSession only binds the child — the window must be enabled explicitly
        await session.enable();
      }
      const st = await session.status();
      if (st !== "active") {
        this.release(input.routerIdentity, row!.id);
        await this.transition(row!.id, "unknown", { reason: `safe mode status=${st} setelah enable` });
        throw new AppError("SAFE_MODE_UNAVAILABLE", "Safe Mode tidak aktif setelah enable; transaksi ditandai unknown.", 409);
      }
      (this.sessions).set(row!.id, session);
      await this.deps.db.insert(auditEvents).values({
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
        const current = await this.require(row!.id);
        if (current.state === "active") {
          if (err instanceof AppError) {
            await this.transition(row!.id, "rolling_back", { reason: err.message });
            await this.transition(row!.id, "rolled_back", { reason: err.message });
          } else {
            await this.transition(row!.id, "unknown", { reason: err instanceof Error ? err.message : String(err) });
          }
        }
      } catch {
        /* ignore bookkeeping errors */
      }
      this.release(input.routerIdentity, row!.id);
      throw err;
    }
  }

  /** State unknown releases the in-process lock but stays on the books until reconciled. */
  private async markUnknown(txId: string, reason: string): Promise<void> {
    const row = await this.require(txId);
    if (row.state === "unknown") {
      await this.transition(txId, "unknown", { reason });
      return;
    }
    await this.transition(txId, "unknown", { reason });
    this.sessions.delete(txId);
    this.release(row.routerIdentity ?? "", txId);
  }

  getSession(txId: string): SafeModeSession | null {
    return this.sessions.get(txId) ?? null;
  }

  recordAction(txId: string): void {
    const n = (this.actionCount.get(txId) ?? 0) + 1;
    if (n > this.deps.maxActionsPerTransaction) {
      throw new AppError("VALIDATION_FAILED", `Batas aksi RouterOS per transaksi (${this.deps.maxActionsPerTransaction}) terlampaui.`, 400);
    }
    this.actionCount.set(txId, n);
  }

  getActionCount(txId: string): number {
    return this.actionCount.get(txId) ?? 0;
  }

  async execInSession(txId: string, userId: string, command: string): Promise<{ output: string }> {
    const row = await this.require(txId);
    this.assertOwner(row.lockOwner, userId);
    await this.assertActive(txId);
    const session = this.sessions.get(txId);
    if (!session || !session.exec) {
      throw new AppError("SAFE_MODE_UNAVAILABLE", "Sesi safe mode tidak mendukung eksekusi command langsung.", 500);
    }
    const res = await session.exec(command);
    this.recordAction(txId);
    return res;
  }

  /** Before every mutation batch: is the session still alive + safe mode open? */
  async assertActive(txId: string): Promise<void> {
    const row = await this.require(txId);
    if (row.state !== "active" && row.state !== "verifying") {
      throw new AppError("SAFE_MODE_UNAVAILABLE", `Transaksi ${row.state} — mutasi baru ditolak.`, 409);
    }
    const session = this.sessions.get(txId);
    if (!session) {
      await this.markUnknown(txId, "session hilang");
      throw new AppError("SAFE_MODE_UNAVAILABLE", "Sesi Safe Mode tidak ditemukan; transaksi unknown.", 409);
    }
    const st = await session.status();
    if (st !== "active") {
      await this.markUnknown(txId, `safe mode status=${st} sebelum mutasi`);
      throw new AppError("SAFE_MODE_UNAVAILABLE", "Sesi Safe Mode tertutup; transaksi unknown — lakukan reconciliasi.", 409);
    }
  }

  /** Commit path: verify → commit; any doubt → rollback or unknown. */
  async commit(txId: string, userId: string): Promise<{ state: TxState }> {
    const row = await this.require(txId);
    this.assertOwner(row.lockOwner, userId);
    const session = this.sessions.get(txId);
    if (!session) {
      await this.markUnknown(txId, "session hilang saat commit");
      return { state: "unknown" };
    }

    await this.transition(txId, "verifying", { phase: "pre-commit checks" });
    const check = await this.deps.verifyChecks({
      userId: row.lockOwner ?? "",
      connectionId: row.connectionId,
      routerIdentity: row.routerIdentity ?? "",
    });
    if (!check.ok) {
      this.deps.logger.warn(`pre-commit check failed for tx ${txId}`, { detail: check.detail });
      await this.rollback(txId, userId, { reason: check.detail });
      return { state: "rolled_back" };
    }

    await this.transition(txId, "committing", { phase: "commit" });
    try {
      await session.commit();
    } catch {
      // commit attempt failed or connection dropped mid-commit: probe, never guess
      const st = await session.status().catch(() => "unknown" as const);
      if (st === "active") {
        // window still open → commit did not happen; roll back
        await this.rollback(txId, userId, { reason: "commit gagal; window masih aktif" });
        return { state: "rolled_back" };
      }
      await this.markUnknown(txId, `commit error; status=${st}`);
      return { state: "unknown" };
    }
    await this.transition(txId, "committed", { phase: "done" });
    await this.cleanup(txId, row.routerIdentity ?? "");
    await this.deps.db.insert(auditEvents).values({
      userId,
      action: "transaction.committed",
      connectionId: row.connectionId,
      metadata: { transactionId: txId },
    });
    return { state: "committed" };
  }

  /** Rollback: requested → verified; controlled recheck before concluding. */
  async rollback(txId: string, userId: string, meta: { reason: string }): Promise<{ state: TxState }> {
    const row = await this.require(txId);
    this.assertOwner(row.lockOwner, userId);
    await this.transition(txId, "rolling_back", { reason: meta.reason });
    const session = this.sessions.get(txId);
    try {
      await session?.rollback();
      // controlled recheck: closing the session auto-reverts; probe the window
      const st = await session?.status().catch(() => "unknown" as const);
      if (st === "active") {
        // window still open — session close did not revert
        await this.transition(txId, "unknown", { reason: "rollback: window masih aktif" });
        return { state: "unknown" };
      }
      await this.transition(txId, "rolled_back", { reason: meta.reason });
      await this.cleanup(txId, row.routerIdentity ?? "");
      await this.deps.db.insert(auditEvents).values({
        userId,
        action: "transaction.rolled_back",
        connectionId: row.connectionId,
        metadata: { transactionId: txId, reason: meta.reason },
      });
      return { state: "rolled_back" };
    } catch (err) {
      await this.markUnknown(txId, `rollback error: ${err instanceof Error ? err.message : String(err)}`);
      return { state: "unknown" };
    }
  }

  /**
   * Reconciliation after crash/drop: read the router's current safe-mode state
   * and close the books. NEVER replays mutations.
   */
  async reconcile(txId: string, opts?: { resolveOrphan?: boolean }): Promise<{ state: TxState }> {
    const row = await this.require(txId);
    if (row.state === "committed" || row.state === "rolled_back") return { state: row.state as TxState };
    const session = this.sessions.get(txId) ?? null;
    let st: "active" | "closed" | "unknown" = session ? await session.status().catch(() => "unknown" as const) : "unknown";
    if (st === "unknown" && !session && opts?.resolveOrphan && this.deps.verifyChecks && row.connectionId) {
      try {
        const check = await this.deps.verifyChecks({ userId: row.lockOwner ?? "system", connectionId: row.connectionId, routerIdentity: row.routerIdentity ?? "" });
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
        await this.transition(txId, "rolled_back", { reason: "reconciled: window masih aktif → rollback" });
      } catch {
        await this.transition(txId, "unknown", { reason: "reconcile rollback gagal" });
      }
    } else if (st === "closed") {
      // window closed without our commit → auto-revert happened
      await this.transition(txId, "rolled_back", { reason: "reconciled: window tertutup (auto-revert)" });
    } else {
      // unknown row state may re-reconcile later; never claim committed
      await this.transition(txId, "unknown", { reason: "reconcile: status tidak terbaca" });
    }
    await this.cleanup(txId, row.routerIdentity ?? "");
    return { state: (await this.require(txId)).state as TxState };
  }

  /**
   * Reconciles all pending 'unknown' transactions across the database on startup.
   */
  async reconcileOrphans(): Promise<number> {
    const rows = await this.deps.db
      .select({ id: changeTransactions.id })
      .from(changeTransactions)
      .where(eq(changeTransactions.state, "unknown"))
      .limit(25);
    let resolved = 0;
    for (const row of rows) {
      try {
        const res = await this.reconcile(row.id, { resolveOrphan: true });
        if (res.state === "rolled_back" || res.state === "committed") resolved++;
      } catch (err) {
        this.deps.logger.warn("startup reconcile failed for tx", { id: row.id, error: err instanceof Error ? err.message : String(err) });
      }
    }
    return resolved;
  }

  /**
   * Backend-internal cleanup after Write revoked / disconnect / logout.
   * NOT callable by the model — no policy path exposes this.
   */
  async forceRollback(txId: string, userId: string): Promise<{ state: TxState }> {
    return this.rollback(txId, userId, { reason: "cleanup backend: Write dicabut/disconnect" });
  }

  private assertOwner(lockOwner: string | null, userId: string): void {
    if (lockOwner !== userId) {
      throw new AppError("FORBIDDEN", "Transaksi bukan milik sesi ini.", 403);
    }
  }

  private async require(txId: string) {
    const [row] = await this.deps.db.select().from(changeTransactions).where(eq(changeTransactions.id, txId)).limit(1);
    if (!row) throw new AppError("NOT_FOUND", "Transaksi tidak ditemukan.", 404);
    return row;
  }

  private async transition(txId: string, next: TxState, extra: Record<string, unknown>): Promise<void> {
    const row = await this.require(txId);
    const current = row.state as TxState;
    if (!ALLOWED_TRANSITIONS[current].includes(next)) {
      throw new AppError(
        "CONFLICT",
        `Transisi transaksi tidak valid: ${current} → ${next}.`,
        409,
      );
    }
    // persist the phase BEFORE any external action tied to it
    await this.deps.db
      .update(changeTransactions)
      .set({
        state: next,
        updatedAt: new Date(),
        recoveryMetadata: { ...(row.recoveryMetadata ?? {}), lastTransition: next, ...extra },
      })
      .where(eq(changeTransactions.id, txId));
  }

  private async cleanup(txId: string, routerIdentity: string): Promise<void> {
    this.sessions.delete(txId);
    this.actionCount.delete(txId);
    this.release(routerIdentity, txId);
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

