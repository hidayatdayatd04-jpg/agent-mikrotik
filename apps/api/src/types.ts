import type { Config } from "./lib/config";
import type { Logger } from "./lib/logger";
import type { Database } from "./db";
import type { SessionContext } from "./services/auth";
import type { PolicyDispatcher } from "./policies/dispatcher";

export interface Env {
  Variables: {
    requestId: string;
    config: Config;
    logger: Logger;
    db: Database;
    session: SessionContext | null;
    dispatcher: PolicyDispatcher;
  };
}
