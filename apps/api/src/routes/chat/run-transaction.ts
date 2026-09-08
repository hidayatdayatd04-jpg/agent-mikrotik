import { redactText } from "../../lib/redaction";
import type { OwnedConnection } from "../../agent/tool-executor";
import type { ChatRouteDeps } from "./types";

/** State transaksi lazy + koneksi yang dibagi executor, ensureTransaction, dan settle. */
export interface TxBox {
  txId: string | null;
  conn: OwnedConnection | null;
}

export function createTxBox(): TxBox {
  return { txId: null, conn: null };
}

/** Transaksi Safe Mode dibuka lazily oleh loop tepat sebelum mutasi pertama. */
export function createEnsureTransaction(
  deps: Pick<ChatRouteDeps, "connectors" | "transactions">,
  ids: { userId: string; connectionId: string | null; runId: string },
  box: TxBox,
): () => Promise<{ ok: boolean; transactionId?: string; error?: string }> {
  return async (): Promise<{ ok: boolean; transactionId?: string; error?: string }> => {
    if (box.txId) return { ok: true, transactionId: box.txId };
    if (!ids.connectionId) return { ok: false, error: "Connector tidak tersedia." };
    if (!box.conn) {
      try {
        box.conn = await deps.connectors.requireOwned(ids.userId, ids.connectionId)();
      } catch {
        return { ok: false, error: "Connector tidak tersedia." };
      }
    }
    if (box.conn.status !== "connected" || !box.conn.routerIdentity) {
      return { ok: false, error: "Router belum terhubung atau belum teridentifikasi." };
    }
    // Fail fast tanpa membuka transaksi bila kredensial tersimpan kosong/tak terbaca.
    try {
      const secret = await deps.connectors.decryptCredential(ids.userId, ids.connectionId);
      if (secret === "") return { ok: false, error: "Kredensial tersimpan kosong; perbarui connector." };
    } catch {
      return { ok: false, error: "Kredensial tersimpan tidak dapat dibaca; perbarui connector." };
    }
    try {
      if (!deps.transactions) throw new Error("Layanan transaksi Safe Mode tidak tersedia.");
      const res = await deps.transactions.begin({
        userId: ids.userId,
        connectionId: ids.connectionId,
        routerIdentity: box.conn.routerIdentity,
        runId: ids.runId,
        snapshotPlan: [{ name: "identity", command: "/system identity print" }],
      });
      box.txId = res.transactionId;
      return { ok: true, transactionId: box.txId };
    } catch (err) {
      const msg = redactText(err instanceof Error ? err.message : String(err));
      return { ok: false, error: msg };
    }
  };
}
