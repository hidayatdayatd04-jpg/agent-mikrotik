import { probeRouter } from "./ssh-probe";
import type { RouterMode } from "@shared/index";
import { createConnector } from "./connector/create";
import { updateConnector } from "./connector/update";
import { listConnectors, removeConnector } from "./connector/manage";
import { connectRouter, disconnectRouter } from "./connector/connection";
import { getConnectorMode, setConnectorMode } from "./connector/mode";
import { decryptCredential } from "./connector/credentials";
import { requireOwned } from "./connector/ownership";
import type { ConnectorCtx, ConnectorServiceDeps } from "./connector/types";

export type { ConnectorServiceDeps } from "./connector/types";

export function createConnectorService(deps: ConnectorServiceDeps) {
  const ctx: ConnectorCtx = {
    db: deps.db,
    keyRing: deps.keyRing,
    targetPolicy: deps.targetPolicy,
    sshTimeoutMs: deps.sshTimeoutMs,
    log: deps.log,
    probeFn: deps.probe ?? probeRouter,
  };

  return {
    list: (userId: string) => listConnectors(ctx, userId),
    create: (userId: string, input: { label: string; host: string; port: number; username: string; password: string }) =>
      createConnector(ctx, userId, input),
    update: (
      userId: string,
      connectionId: string,
      input: { label?: string; host?: string; port?: number; username?: string; password?: string },
    ) => updateConnector(ctx, userId, connectionId, input),
    connect: (userId: string, connectionId: string) => connectRouter(ctx, userId, connectionId),
    disconnect: (userId: string, connectionId: string) => disconnectRouter(ctx, userId, connectionId),
    setMode: (userId: string, connectionId: string, mode: RouterMode, expectedVersion: number) =>
      setConnectorMode(ctx, userId, connectionId, mode, expectedVersion),
    getMode: (userId: string, connectionId: string) => getConnectorMode(ctx, userId, connectionId),
    remove: (userId: string, connectionId: string) => removeConnector(ctx, userId, connectionId),
    decryptCredential: (userId: string, connectionId: string) => decryptCredential(ctx, userId, connectionId),
    requireOwned: (userId: string, connectionId: string) => requireOwned(ctx, userId, connectionId),
  };
}

export type ConnectorService = ReturnType<typeof createConnectorService>;
