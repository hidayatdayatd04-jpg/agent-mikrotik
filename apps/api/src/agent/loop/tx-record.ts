import { and, eq, inArray } from "drizzle-orm";
import { changeTransactions } from "../../db/schema";
import { AppError } from "../../lib/errors";
import type { ChatMessage } from "../chat-client";
import type { EmitFn } from "./context";
import type { StartRunInput } from "./types";
import type { SingleToolEnv } from "./single-tool";

/** transaction-aware tool calls: only record SUCCESSFUL MUTATION tools. */
export async function recordTxAction(
  env: SingleToolEnv,
  input: StartRunInput,
  emitSeq: EmitFn,
  chatHistory: ChatMessage[],
): Promise<void> {
  const [tx] = await env.db
    .select()
    .from(changeTransactions)
    .where(and(
      eq(changeTransactions.connectionId, input.connectionId ?? ""),
      inArray(changeTransactions.state, ["preparing", "active", "verifying"]),
    ))
    .limit(1);
  if (tx) {
    try {
      env.txCoordinator.recordAction(tx.id);
      await emitSeq({
        type: "transaction.updated",
        payload: {
          transactionId: tx.id,
          state: tx.state,
          actions: env.txCoordinator.getActionCount(tx.id),
        },
      });
    } catch (err) {
      if (err instanceof AppError) {
        // Catatan mid-conversation sebagai user (bukan system):
        // endpoint OpenAI-compatible Gemini hanya menerima satu
        // system message di awal; system di tengah → 400.
        chatHistory.push({
          role: "user",
          content: `[Batas transaksi] Batas aksi transaksi tercapai: ${err.message}`,
        });
      }
    }
  }
}
