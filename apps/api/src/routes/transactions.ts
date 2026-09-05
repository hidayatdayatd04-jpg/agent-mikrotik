import { Hono } from "hono";
import { and, eq, desc } from "drizzle-orm";
import type { Env } from "../types";
import type { Database } from "../db";
import { AppError } from "../lib/errors";
import { changeTransactions } from "../db/schema";
import type { TransactionCoordinator } from "../transactions/coordinator";
import type { Logger } from "../lib/logger";
import type { SessionContext } from "../services/auth";

/**
 * Owner-facing transaction endpoints (M6). The MODEL never calls these — the
 * agent loop reaches the coordinator internally, and enable/commit/rollback
 * safe-mode tools are denied by the policy dispatcher for model calls.
 */
export function createTransactionRoutes(deps: {
  coordinator: TransactionCoordinator;
  db: Database;
  logger: Logger;
  connectors: {
    requireOwned: (userId: string, connectionId: string) => () => Promise<{
      id: string;
      userId: string;
      routerIdentity: string | null;
      status: string;
    }>;
    getMode: (userId: string, connectionId: string) => Promise<{ mode: "read-only" | "write"; version: number }>;
  };
}) {
  const routes = new Hono<Env>();

  routes.get("/", async (c) => {
    const session = requireSession(c);
    const rows = await deps.db
      .select()
      .from(changeTransactions)
      .orderBy(desc(changeTransactions.updatedAt))
      .limit(50);
    // owner-scoped: only the owner's transactions, no other-user identity
    const mine = rows.filter((r) => r.lockOwner === session.userId);
    return c.json({
      transactions: mine.map((r) => ({
        id: r.id,
        connectionId: r.connectionId,
        state: r.state,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      })),
    });
  });

  routes.post("/begin", async (c) => {
    const session = requireSession(c);
    const body = (await c.req.json().catch(() => null)) as { connectionId?: string; runId?: string | null } | null;
    if (!body?.connectionId) {
      throw new AppError("VALIDATION_FAILED", "connectionId wajib diisi.", 422);
    }
    const conn = await deps.connectors.requireOwned(session.userId, body.connectionId)();
    if (conn.status !== "connected") {
      throw new AppError("CONFLICT", "Connector harus tersambung dan terverifikasi sebelum transaksi.", 409);
    }
    const { mode } = await deps.connectors.getMode(session.userId, body.connectionId);
    if (mode !== "write") {
      throw new AppError("SAFE_MODE_UNAVAILABLE", "Transaksi hanya tersedia pada mode Write.", 409);
    }
    if (!conn.routerIdentity) {
      throw new AppError("CONFLICT", "Identitas router belum terverifikasi; sambungkan ulang connector.", 409);
    }
    const { transactionId } = await deps.coordinator.begin({
      userId: session.userId,
      connectionId: body.connectionId,
      routerIdentity: conn.routerIdentity,
      runId: body.runId ?? null,
      snapshotPlan: [{ name: "identity", command: "/system identity print" }],
    });
    return c.json({ transactionId }, 201);
  });

  routes.post("/:id/commit", async (c) => {
    const session = requireSession(c);
    const r = await deps.coordinator.commit(c.req.param("id"), session.userId);
    return c.json(r);
  });

  routes.post("/:id/rollback", async (c) => {
    const session = requireSession(c);
    const r = await deps.coordinator.rollback(c.req.param("id"), session.userId, { reason: "permintaan pengguna" });
    return c.json(r);
  });

  routes.get("/:id", async (c) => {
    const session = requireSession(c);
    const [row] = await deps.db
      .select()
      .from(changeTransactions)
      .where(and(eq(changeTransactions.id, c.req.param("id")), eq(changeTransactions.lockOwner, session.userId)))
      .limit(1);
    if (!row) throw new AppError("NOT_FOUND", "Transaksi tidak ditemukan.", 404);
    return c.json({
      transaction: {
        id: row.id,
        connectionId: row.connectionId,
        state: row.state,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      },
    });
  });

  function requireSession(c: { get: (k: "session") => unknown }): SessionContext {
    const s = c.get("session");
    if (!s) throw new AppError("AUTH_REQUIRED", "Silakan masuk terlebih dahulu.", 401);
    return s as SessionContext;
  }

  return routes;
}
