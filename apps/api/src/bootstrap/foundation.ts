import { resolve } from "node:path";
import { createRequire } from "node:module";
import { ensureLocalKey } from "../lib/local-files";
import { loadConfig } from "../lib/config";
import { createLogger } from "../lib/logger";
import { createDb, recoverLocalState } from "../db";
import { envKeyRing } from "../lib/crypto";
import { McpSupervisor } from "../mcp/supervisor";
import { makeSpawnPlan } from "../mcp/spawn-plan";
import { RosettaProcess } from "../mcp/rosetta";

export const config = loadConfig();
export const logger = createLogger(config.LOG_LEVEL);
export const db = createDb(resolve(config.DATA_DIR, "agent.sqlite"));
recoverLocalState(db);

const nodeRequire = createRequire(import.meta.url);

function resolveRosettaCli(): string {
  // rosetta has no "main"/"exports"; resolve the bin entry directly from node_modules.
  return nodeRequire.resolve("@tikoci/rosetta/bin/rosetta.js");
}

export const keyRing = envKeyRing({ 1: ensureLocalKey(config.DATA_DIR) }, 1);

export const supervisor = new McpSupervisor(
  makeSpawnPlan(config.MCP_BUN_EXECUTABLE),
  {
    maxPerUser: config.MAX_MCP_PROCESSES_PER_USER,
    total: config.MAX_MCP_PROCESSES_TOTAL,
    idleTimeoutMs: config.MCP_IDLE_TIMEOUT_SECONDS * 1000,
    startupTimeoutMs: 30_000,
  },
  logger,
);

const rosettaCli = resolveRosettaCli();
export const rosetta = new RosettaProcess({
  bunExecutable: config.MCP_BUN_EXECUTABLE,
  rosettaCliPath: rosettaCli,
  dbPath: config.rosettaDbPath,
  logger,
});
