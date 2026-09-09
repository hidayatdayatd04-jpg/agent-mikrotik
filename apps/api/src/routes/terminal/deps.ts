import { z } from "zod";
import type { Database } from "../../db";
import type { Logger } from "../../lib/logger";
import type { ConnectorService } from "../../services/connector";
import type { TransactionCoordinator } from "../../transactions/coordinator";

export const OpenSchema = z.object({
  connectionId: z.string().uuid(),
  conversationId: z.string().uuid().nullable().optional(),
});

export const CommandSchema = z.object({
  command: z.string().min(1).max(4000),
  conversationId: z.string().uuid().nullable().optional(),
});

export interface TerminalRouteDeps {
  db: Database;
  logger: Logger;
  connectors: ConnectorService;
  transactions: TransactionCoordinator;
}

/** Adapter deps service terminal dari deps route (binding coordinator). */
export function buildTerminalDeps(deps: TerminalRouteDeps) {
  return {
    db: deps.db,
    logger: deps.logger,
    decryptCredential: (u: string, cId: string) => deps.connectors.decryptCredential(u, cId),
    getMode: (u: string, cId: string) => deps.connectors.getMode(u, cId),
    transactions: {
      begin: deps.transactions.begin.bind(deps.transactions),
      commit: deps.transactions.commit.bind(deps.transactions),
      rollback: (txId: string, userId: string, meta: { reason: string }) =>
        deps.transactions.rollback(txId, userId, meta),
      getActionCount: (txId: string) => deps.transactions.getActionCount(txId),
      recordAction: (txId: string) => deps.transactions.recordAction(txId),
      execInSession: (txId: string, userId: string, command: string) =>
        deps.transactions.execInSession(txId, userId, command),
    },
  };
}
