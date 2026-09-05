export const TOOL_ORIGIN = {
  UPSTREAM: "upstream",
  CUSTOM: "custom",
} as const;

export type ToolOrigin = (typeof TOOL_ORIGIN)[keyof typeof TOOL_ORIGIN];

export const TOOL_RISK = {
  READ_ONLY: "read-only",
  WRITE: "write",
  DESTRUCTIVE: "destructive",
} as const;

export type ToolRisk = (typeof TOOL_RISK)[keyof typeof TOOL_RISK];

export interface ToolManifest {
  id: string;
  version: string;
  origin: ToolOrigin;
  description: string;
  inputSchema: unknown;
  outputSchema?: unknown;
  risk: ToolRisk;
  capabilities: string[];
  timeoutMs: number;
  idempotent: boolean;
  sensitiveFields: string[];
  recoveryStrategy: string;
  commandPath?: string;
}
