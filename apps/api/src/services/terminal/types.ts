import type { Database } from "../../db";
import type { Logger } from "../../lib/logger";
import type { sshExec } from "../ssh-exec";

export interface TerminalDeps {
  execSsh?: (opts: Parameters<typeof sshExec>[0]) => ReturnType<typeof sshExec>;
  db: Database;
  logger: Logger;
  decryptCredential: (userId: string, connectionId: string) => Promise<string>;
  getMode: (userId: string, connectionId: string) => Promise<{ mode: "read-only" | "write"; version: number }>;
  transactions?: {
    begin: (input: { userId: string; connectionId: string; routerIdentity: string; runId: string | null; snapshotPlan: { name: string; command: string }[] }) => Promise<{ transactionId: string }>;
    commit: (txId: string, userId: string) => Promise<{ state: string }>;
    rollback: (txId: string, userId: string, meta: { reason: string }) => Promise<{ state: string }>;
    getActionCount: (txId: string) => number;
    recordAction?: (txId: string) => void;
    execInSession?: (txId: string, userId: string, command: string) => Promise<{ output: string }>;
  };
}
