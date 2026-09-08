import { diagnoseWriteBlock } from "../../agent/write-diagnostics";
import type { ChatRouteDeps } from "./types";
import type { TxBox } from "./run-transaction";

/**
 * Pre-check TANPA membuka transaksi (lazy): downgrade ke read-only hanya
 * bila pemblokir sudah pasti diketahui (disconnect/identitas/kredensial).
 * Kondisi sehat → mode write-otorisasi; transaksi dibuka lazily oleh
 * loop tepat sebelum mutasi pertama via ensureTransaction.
 */
export async function resolveRunMode(
  deps: Pick<ChatRouteDeps, "connectors">,
  args: {
    userId: string;
    connectionId: string | null;
    mode: "read-only" | "write";
    readOnlyRequested: boolean;
    box: TxBox;
  },
): Promise<{ conn: TxBox["conn"]; effectiveMode: "read-only" | "write"; writeBlockNote: string | undefined }> {
  const { box, connectionId, mode } = args;
  let beginError: string | null = null;
  let emptyCredential: boolean | null = null;

  if (connectionId) {
    try {
      box.conn = await deps.connectors.requireOwned(args.userId, connectionId)();
    } catch {
      beginError = "Connector tidak tersedia.";
    }
  }
  if (mode === "write" && connectionId && !beginError) {
    try {
      emptyCredential = (await deps.connectors.decryptCredential(args.userId, connectionId)) === "";
    } catch {
      beginError = "Kredensial tersimpan tidak dapat dibaca; perbarui connector.";
    }
  }
  const conn = box.conn;
  const preBlocked =
    mode === "write" &&
    !args.readOnlyRequested &&
    (!!beginError || conn?.status !== "connected" || !conn?.routerIdentity || emptyCredential === true);
  if (preBlocked && !beginError) {
    beginError = !conn || conn.status !== "connected" || !conn.routerIdentity
      ? "Router belum terhubung atau belum teridentifikasi."
      : "Kredensial tersimpan kosong; perbarui connector.";
  }
  const effectiveMode = mode === "write" && !args.readOnlyRequested && !preBlocked ? "write" : "read-only";
  const writeBlockNote = preBlocked
    ? diagnoseWriteBlock({ mode, connected: conn?.status === "connected", hasIdentity: !!conn?.routerIdentity, emptyCredential, beginError }).note
    : undefined;
  return { conn, effectiveMode, writeBlockNote };
}
