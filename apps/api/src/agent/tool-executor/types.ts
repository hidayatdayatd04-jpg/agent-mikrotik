import type { McpSupervisor } from "../../mcp/supervisor";
import type { ConnectorService } from "../../services/connector";
import type { Logger } from "../../lib/logger";
import type { NetworkMapService } from "../../services/network-map";

/** Baris koneksi milik user dari `connectors.requireOwned(... )()`. */
export type OwnedConnection = Awaited<ReturnType<ReturnType<ConnectorService["requireOwned"]>>>;

export interface ToolExecDeps {
  supervisor: McpSupervisor;
  connectors: ConnectorService;
  logger: Logger;
  timeoutMs?: number;
  networkMap?: NetworkMapService;
}

export interface ToolExecInput {
  userId: string;
  connectionId: string;
  fqName: string;
  args: unknown;
  /** Set only by the dispatcher for a read outside an active transaction. */
  retryRead?: boolean;
}

export interface ToolExecResult {
  ok: boolean;
  output: string;
  errorCode?: string;
}
