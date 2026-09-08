import { and, eq, sql } from "drizzle-orm";
import { redactText } from "../../lib/redaction";
import type { RunEvent } from "../../agent/loop";
import { agentRuns, changeTransactions, messages } from "../../db/schema";
import type { ChatCtx } from "./types";
import type { RunPublisher } from "./run-publish";

export interface SettleState {
  status: "completed" | "failed" | "cancelled";
  terminalEvent: RunEvent | undefined;
}

/** Settlement transaksi + status run + event terminal (blok finally executor). */
export async function settleBackgroundRun(
  ctx: ChatCtx,
  args: {
    txId: string | null;
    state: SettleState;
    runId: string;
    conversationId: string;
    userId: string;
    publish: RunPublisher["publish"];
  },
): Promise<void> {
  const { deps, backgroundRuns } = ctx;
  const { txId } = args;
  const { state } = args;
  if (txId && deps.transactions) {
    let txState = "unknown";
    let settleReason: string | null = null;
    const actions = deps.transactions.getActionCount(txId);
    try {
      const [stored] = await deps.db.select({ state: changeTransactions.state }).from(changeTransactions)
        .where(eq(changeTransactions.id, txId));
      if (stored && !["active", "preparing", "verifying"].includes(stored.state)) {
        txState = stored.state;
      } else {
        settleReason = actions === 0 ? "empty" : state.status !== "completed" ? "run gagal/dibatalkan" : null;
        const result = state.status === "completed" && actions > 0
          ? await deps.transactions.commit(txId, args.userId)
          : await deps.transactions.rollback(txId, args.userId, { reason: settleReason ?? "empty" });
        txState = result.state;
      }
    } catch (err) {
      deps.logger.error("transaction settlement failed", { transactionId: txId, message: redactText(err instanceof Error ? err.message : String(err)) });
    }
    args.publish({ runId: args.runId, seq: 0, type: "transaction.updated", payload: { transactionId: txId, state: txState, actions, reason: settleReason } });
    if (state.status === "completed" && (txState === "unknown" || (actions > 0 && txState !== "committed"))) {
      state.status = "failed";
      state.terminalEvent = undefined;
      // Temuan 2 fix: hanya update pesan assistant milik run terkait,
      // bukan seluruh riwayat assistant di percakapan.
      await deps.db
        .update(messages)
        .set({ status: "failed" })
        .where(and(
          eq(messages.conversationId, args.conversationId),
          eq(messages.role, "assistant"),
          sql`json_extract(${messages.content}, '$.runId') = ${args.runId}`,
        ));
    }
  }
  await deps.db.update(agentRuns).set({ status: state.status, endedAt: new Date() }).where(eq(agentRuns.id, args.runId));
  backgroundRuns.delete(args.runId);
  args.publish(state.terminalEvent ?? { runId: args.runId, seq: 0, type: `run.${state.status}`, payload: state.status === "failed" ? { code: "RUN_FAILED", message: "Run atau penyelesaian transaksi gagal. Periksa status transaksi sebelum mencoba lagi." } : {} });
}
