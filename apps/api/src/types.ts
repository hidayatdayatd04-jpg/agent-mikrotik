import type { Config } from "./lib/config";
import type { Logger } from "./lib/logger";
import type { Database } from "./db";

export interface Env {
  Variables: {
    requestId: string;
    config: Config;
    logger: Logger;
    db: Database;
  };
}
