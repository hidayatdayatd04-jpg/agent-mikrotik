import { customManifests } from "@mikrotik-tools/index";
import { config, db, keyRing, logger, rosetta, supervisor } from "./foundation";
import { createTargetPolicy } from "../services/target-policy";
import { createConnectorService } from "../services/connector";
import { createNetworkMapService } from "../services/network-map";
import { createNotificationService } from "../services/notification";
import { createMonitoringService } from "../services/monitoring";
import { createBackupService } from "../services/backup";
import { createApprovalService } from "../services/approval";
import { normalizeCustomTools } from "../policies/normalize";
import { createLiveCatalogSource } from "../policies/live-catalog";
import { PolicyDispatcher } from "../policies/dispatcher";
import { NETWORK_MAP_TOOL } from "../agent/network-map-tool";
import { WEB_SEARCH_TOOL } from "../agent/web-search-tool";
import { auditEvents } from "../db/schema";
import { ZodSchemaValidator } from "../policies/schema-validator";
import { TransactionCoordinator } from "../transactions/coordinator";
import { createSafeModeSessionFactory } from "../transactions/mcp-session";

export const connectors = createConnectorService({
  db,
  keyRing,
  targetPolicy: createTargetPolicy(config.routerAllowedCidrs),
  sshTimeoutMs: config.SSH_CONNECT_TIMEOUT_MS,
  log: (msg, data) => logger.info(msg, data),
});

export const networkMap = createNetworkMapService({ connectors, targetPolicy: createTargetPolicy(config.routerAllowedCidrs) });
export const notifications = createNotificationService({ db });
export const monitoring = createMonitoringService({ db, connectors, notifications });
export const backups = createBackupService({ db, connectors });
export const approvals = createApprovalService({ db, backups, notifications });

// Policy dispatcher (M5): single execution path for all tool calls.
const customTools = [...normalizeCustomTools(customManifests()), NETWORK_MAP_TOOL, WEB_SEARCH_TOOL];
export const catalogSource = createLiveCatalogSource({
  // system-level children: the supervisor respawns per (user,connection) specs
  // with the right mode when agent runs request them; these cover catalog
  // discovery for policy decisions.
  getFullChild: () => supervisor.getOrSpawn({ connectionId: "catalog-full", userId: "system", host: "catalog", port: 22, username: "catalog", password: null, hostKeyFingerprint: null, readOnly: false }),
  getReadOnlyChild: () => supervisor.getOrSpawn({ connectionId: "catalog-readonly", userId: "system", host: "catalog", port: 22, username: "catalog", password: null, hostKeyFingerprint: null, readOnly: true }),
  rosettaToolNames: async () => {
    const tools = (await rosetta.listTools()) as { name: string; description?: string; inputSchema?: unknown }[];
    return tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }));
  },
  customTools,
});

export const dispatcher = new PolicyDispatcher({
  modeSource: {
    getMode: (userId, connectionId) => connectors.getMode(userId, connectionId),
  },
  catalog: catalogSource,
  validator: new ZodSchemaValidator(),
  audit: (event) => {
    void db
      .insert(auditEvents)
      .values({
        userId: event.userId === "system" ? null : event.userId,
        action: `tool.${event.decision}`,
        metadata: { tool: event.tool, code: event.code ?? null },
      })
      .catch((err: unknown) => logger.error("audit insert failed", { message: err instanceof Error ? err.message : String(err) }));
  },
});

// M6 transaction coordinator: backend-only safe-mode state machine.
export const safeModeSessions = createSafeModeSessionFactory({
  supervisor,
  logger,
  getConnection: async (userId, connectionId) => {
    const row = await connectors.requireOwned(userId, connectionId)();
    const password = await connectors.decryptCredential(userId, connectionId);
    return {
      userId,
      connectionId,
      spec: {
        host: row.host,
        port: row.port,
        username: row.username,
        password,
        hostKeyFingerprint: row.hostKeyFingerprint,
      },
    };
  },
});

export const txCoordinator = new TransactionCoordinator({
  db,
  logger,
  maxActionsPerTransaction: config.MAX_ACTIONS_PER_TRANSACTION,
  openSession: (ctx) => safeModeSessions.openSession(ctx),
  openVerifiedSession: (ctx) => safeModeSessions.openVerifiedSession(ctx),
  verifyChecks: (ctx) => safeModeSessions.verifyManagement(ctx),
});
