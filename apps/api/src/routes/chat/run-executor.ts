import { isReadOnlyIntent } from "../../agent/intent";
import type { RunEvent } from "../../agent/loop";
import type { WorkspaceContext } from "../../lib/workspace";
import type { ProviderConfigWithKey } from "../../agent/provider-settings";
import type { ChatCtx, ConversationRow, RunInput, RunRow } from "./types";
import { createRunPublisher } from "./run-publish";
import { createEnsureTransaction, createTxBox } from "./run-transaction";
import { resolveRunMode } from "./run-mode";
import { buildRunClient, loadMemorySummary } from "./run-client";
import { settleBackgroundRun, type SettleState } from "./run-settle";

/** Eksekusi background satu run: transaksi lazy, client, loop, settlement. */
export async function executeBackgroundRun(
  ctx: ChatCtx,
  args: {
    workspace: WorkspaceContext;
    conv: ConversationRow;
    run: RunRow;
    input: RunInput;
    cfg: ProviderConfigWithKey | null;
    userMessageId: string;
    attachmentNote: string;
    connectionId: string | null;
    mode: "read-only" | "write";
    modeVersion: number;
  },
): Promise<void> {
  const { deps } = ctx;
  const { workspace, conv, run, input, cfg, connectionId, mode } = args;
  const state: SettleState = { status: "failed", terminalEvent: undefined };
  const box = createTxBox();
  const { publish } = createRunPublisher(ctx, run.id, conv.id, () => box.txId);
  const ensureTransaction = createEnsureTransaction(deps, { userId: workspace.userId, connectionId, runId: run.id }, box);

  try {
    const readOnlyRequested = isReadOnlyIntent(input.text);
    const { conn, effectiveMode, writeBlockNote } = await resolveRunMode(deps, {
      userId: workspace.userId,
      connectionId,
      mode,
      readOnlyRequested,
      box,
    });
    // per-run provider client (real provider bila dikonfigurasi; mock bila belum)
    // Fallback kompatibel (#6) + rate limiter terpusat (#1): primer → cadangan
    // bila primer dibatasi/kuota habis; mode policy tetap read-only/write apa
    // adanya — fallback TIDAK PERNAH mengaktifkan write tools (#8).
    const policyModeForCtx = readOnlyRequested ? "read-only" : mode;
    const client = await buildRunClient(ctx, {
      cfg,
      userId: workspace.userId,
      input,
      runId: run.id,
      conversationId: conv.id,
      policyMode: policyModeForCtx,
    });
    const routerLabel = conn?.status === "connected" ? conn.routerIdentity ?? conn.host : null;
    // Memory summary (untrusted data, never authority): latest compacted context.
    const memorySummary = await loadMemorySummary(ctx, conv.id);
    const result = await deps.loop.run(
      {
        runId: run.id,
        userId: workspace.userId,
        conversationId: conv.id,
        connectionId: connectionId ?? null,
        userMessageId: args.userMessageId,
        userText: input.text + args.attachmentNote,
        policy: {
          userId: workspace.userId,
          connectionId: connectionId ?? "none",
          connectionHost: conn?.host ?? undefined,
          managementInterface: (conn as any)?.managementInterface ?? undefined,
          mode: effectiveMode,
          connectorMode: mode,
          runMode: readOnlyRequested ? "read-only" : mode,
          modeVersion: args.modeVersion,
          transactionState: box.txId ? "active" : "none",
        },
        ensureTransaction,
        client,
        executeTool: (call) => {
          if (call.fqName.startsWith("docs:")) {
            return deps.executeDocsTool({ fqName: call.fqName, args: call.args });
          }
          if (call.fqName.startsWith("web:")) {
            return deps.executeWebSearchTool({ userId: workspace.userId, args: call.args });
          }
          if (connectionId && connectionId !== "none") {
            return deps.executeTool({ userId: workspace.userId, connectionId, fqName: call.fqName, args: call.args, retryRead: call.retryRead });
          }
          return Promise.resolve({ ok: false, output: "Tidak ada router aktif pada percakapan ini.", errorCode: "TOOL_UNSUPPORTED" });
        },
        systemInstruction: deps.buildInstruction({
          mode: effectiveMode,
          routerLabel,
          modelLabel: client.modelLabel,
          txActive: box.txId !== null,
          writeBlockNote,
          memorySummary,
          rosVersion: (conn as any)?.rosVersion ?? null,
          boardName: (conn as any)?.boardName ?? null,
          architecture: (conn as any)?.architecture ?? null,
          connectionHost: conn?.host ?? null,
          managementInterface: (conn as any)?.managementInterface ?? null,
        }),
      },
      (e) => {
        if (["run.completed", "run.failed", "run.cancelled"].includes(e.type)) state.terminalEvent = e as RunEvent;
        else publish(e);
        return Promise.resolve();
      },
    );
    state.status = result.status;
  } catch (err) {
    deps.logger.error("background run crashed", { runId: run.id, message: err instanceof Error ? err.message : String(err) });
  } finally {
    await settleBackgroundRun(ctx, {
      txId: box.txId,
      state,
      runId: run.id,
      conversationId: conv.id,
      userId: workspace.userId,
      publish,
    });
  }
}
