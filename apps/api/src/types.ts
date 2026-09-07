import type { Config } from "./lib/config";
import type { Logger } from "./lib/logger";
import type { Database } from "./db";
import type { WorkspaceContext } from "./lib/workspace";
import type { PolicyDispatcher } from "./policies/dispatcher";

export interface AccountContext {
  id: string;
  workspaceId: string;
  username: string;
  displayName: string;
  loginAlias: string | null;
}

export interface Env {
  Variables: {
    requestId: string;
    config: Config;
    logger: Logger;
    db: Database;
    workspace: WorkspaceContext | null;
    account: AccountContext | null;
    sessionId: string | null;
    dispatcher: PolicyDispatcher;
  };
}
