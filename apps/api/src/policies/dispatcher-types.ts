import type { NormalizedTool } from "./normalize";

export interface PolicySnapshot {
  userId: string;
  connectionId: string;
  connectionHost?: string;
  managementInterface?: string;
  /** effective mode for this run (intersection of connector + run intent) */
  mode: "read-only" | "write";
  /** original connector mode from DB — used solely for CAS race detection (defaults to mode) */
  connectorMode?: "read-only" | "write";
  modeVersion: number;
  /** run-level mode constraint (e.g. read-only request even when connector has write enabled) */
  runMode?: "read-only" | "write";
  /** transaction state on this connection (M6) */
  transactionState: "none" | "active";
}

export interface ModeSource {
  /** live mode + version from the permissions table (not a cached copy) */
  getMode(userId: string, connectionId: string): Promise<{ mode: "read-only" | "write"; version: number }>;
}

export interface DispatchCheckInput {
  workspace: { userId: string } | null;
  snapshot: PolicySnapshot;
  toolFqName: string;
  args: unknown;
}

export type DispatchDecision =
  | { allowed: true; tool: NormalizedTool }
  | { allowed: false; code: string; message: string };

export interface CatalogSource {
  /** returns the normalized tool catalog for this mode (async: may spawn/respawn MCP children) */
  getCatalog(mode: "read-only" | "write"): Promise<NormalizedTool[]>;
}

export interface SchemaValidator {
  validate(schema: unknown, input: unknown): { ok: boolean; message?: string };
}
