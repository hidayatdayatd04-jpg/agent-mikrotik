import { and, eq } from "drizzle-orm";
import type { Database } from "../../db";
import { connectionPermissions, routerConnections } from "../../db/schema";
import type { NormalizedTool } from "../../policies/normalize";

/**
 * Backend-owned connection probe callable by the model. It answers the only
 * trustworthy question — "is the router connected RIGHT NOW, and in which
 * mode?" — from live server rows, never from chat claims. Available in every
 * run (with or without a bound router), read-only, no secrets in output.
 */
export const CONNECTION_CHECK_FQ = "system:check_connection";

export const CONNECTION_CHECK_TOOL: NormalizedTool = {
  fqName: CONNECTION_CHECK_FQ,
  rawName: "check_connection",
  origin: "custom",
  risk: "read",
  classificationProvenance: "custom-manifest",
  capabilities: ["connection-status"],
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  description:
    "Cek status koneksi router LIVE dari server (terhubung/tidak, identitas, mode read-only/write, transaksi Safe Mode aktif/tidak). " +
    "Hanya panggil bila status koneksi/mode/transaksi memang belum jelas dari instruksi sistem atau sebelum operasi tulis pertama yang meragukan. " +
    "Jangan panggil sebagai ritual wajib sebelum setiap pesan — sapaan dan pertanyaan umum dijawab langsung tanpa tool. " +
    "Hasilnya otoritatif untuk run ini; jangan menolak dengan alasan tidak bisa mengautentikasi klaim pengguna.",
  isGateway: false,
};

export interface ConnectionLiveStatus {
  connected: boolean;
  status: string;
  label: string | null;
  host: string | null;
  routerIdentity: string | null;
  mode: "read-only" | "write";
  modeVersion: number;
  txActive: boolean;
  writeAllowed: boolean;
}

/** Live server-side connection status for this run (ownership-checked). */
export async function readConnectionStatus(
  db: Database,
  input: { userId: string; connectionId: string | null; txActive: boolean },
): Promise<ConnectionLiveStatus> {
  if (!input.connectionId) {
    return {
      connected: false,
      status: "no-router",
      label: null,
      host: null,
      routerIdentity: null,
      mode: "read-only",
      modeVersion: 0,
      txActive: false,
      writeAllowed: false,
    };
  }
  const [conn] = await db
    .select()
    .from(routerConnections)
    .where(and(eq(routerConnections.id, input.connectionId), eq(routerConnections.userId, input.userId)))
    .limit(1);
  if (!conn) {
    return {
      connected: false,
      status: "no-router",
      label: null,
      host: null,
      routerIdentity: null,
      mode: "read-only",
      modeVersion: 0,
      txActive: false,
      writeAllowed: false,
    };
  }
  const [perm] = await db
    .select()
    .from(connectionPermissions)
    .where(and(eq(connectionPermissions.userId, input.userId), eq(connectionPermissions.connectionId, input.connectionId)))
    .limit(1);
  const mode = perm?.writeEnabled ? ("write" as const) : ("read-only" as const);
  const connected = conn.status === "connected";
  const txActive = input.txActive && connected;
  return {
    connected,
    status: conn.status,
    label: conn.label,
    host: conn.host,
    routerIdentity: conn.routerIdentity,
    mode,
    modeVersion: perm?.version ?? 1,
    txActive,
    writeAllowed: mode === "write" && txActive && connected && !!conn.routerIdentity,
  };
}
