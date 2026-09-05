import type { Config } from "./lib/config";
import type { Logger } from "./lib/logger";

export interface Env {
  Variables: {
    requestId: string;
    config: Config;
    logger: Logger;
  };
}
