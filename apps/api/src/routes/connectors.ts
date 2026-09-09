import { Hono } from "hono";
import type { Env } from "../types";
import type { ConnectorService } from "../services/connector";
import type { McpSupervisor } from "../mcp/supervisor";
import type { TransactionCoordinator } from "../transactions/coordinator";
import type { Logger } from "../lib/logger";
import { registerConnectorCrud } from "./connectors/crud";
import { registerConnectorLifecycle } from "./connectors/lifecycle";

export function createConnectorRoutes(deps: {
  connectors: ConnectorService;
  supervisor: McpSupervisor;
  txCoordinator: TransactionCoordinator;
  safeModeSessions: { forget(userId: string, connectionId: string): void };
  logger: Logger;
  invalidateCatalog: () => void;
}) {
  const routes = new Hono<Env>();

  registerConnectorCrud(routes, deps);
  registerConnectorLifecycle(routes, deps);

  return routes;
}
