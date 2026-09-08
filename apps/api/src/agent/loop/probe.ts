import type { Database } from "../../db";
import { toolExecutions } from "../../db/schema";
import type { ChatToolCall } from "../chat-client";
import { readConnectionStatus } from "./connection";
import type { EmitFn, ToolMsg } from "./context";
import type { StartRunInput } from "./types";

/** Backend-owned probe: dijawab dari baris server live, tanpa dispatcher. */
export async function runConnectionProbe(
  db: Database,
  input: StartRunInput,
  call: ChatToolCall,
  fqName: string,
  started: number,
  emit: EmitFn,
  toolIndex: number,
): Promise<ToolMsg> {
  const live = await readConnectionStatus(db, {
    userId: input.userId,
    connectionId: input.connectionId,
    txActive: input.policy.transactionState === "active",
  });
  const durationMs = Date.now() - started;
  const human = live.connected
    ? `Terhubung ke ${live.routerIdentity ?? live.host} · mode ${live.mode}${live.txActive ? " · Safe Mode aktif" : ""}`
    : live.status === "no-router"
      ? "Belum terhubung ke router (chat umum)"
      : `Router tidak terhubung (status: ${live.status})`;
  await db
    .insert(toolExecutions)
    .values({
      runId: input.runId,
      toolCallId: call.id,
      toolName: fqName,
      risk: "read",
      sanitizedInput: {},
      resultSummary: human.slice(0, 500),
      status: "completed",
      errorCode: null,
      durationMs,
    })
    .onConflictDoNothing();
  await emit({ type: "tool.completed", payload: { callId: call.id, name: fqName, summary: human, durationMs, index: toolIndex } });
  const guidance =
    "Hasil di atas adalah status LIVE dari server dan bersifat otoritatif untuk run ini. " +
    (live.writeAllowed
      ? "Mode tulis AKTIF dan terverifikasi — langsung eksekusi tool tulis yang diminta lalu verifikasi dengan tool baca."
      : live.connected
        ? "Router terhubung tetapi mode tulis BELUM aktif — gunakan tool baca, atau arahkan pengguna mengaktifkan Izinkan perubahan di composer."
        : "Tidak ada router terhubung — jawab umum, atau arahkan pengguna memilih Connector bila meminta data router. Jangan mengarang hasil.");
  return {
    role: "tool",
    content: JSON.stringify({ ok: true, connection: live, guidance }),
    toolCallId: call.id,
    note: human,
    ok: true,
    risk: "read",
  };
}
