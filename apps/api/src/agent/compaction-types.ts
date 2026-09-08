import type { Database } from "../db";
import type { Logger } from "../lib/logger";
import type { ChatClient } from "./chat-client";

export interface CompactionDeps {
  db: Database;
  logger: Logger;
  getProvider: (userId: string) => Promise<{ cfg: unknown; client: ChatClient; model: string; provider: string } | null>;
}
