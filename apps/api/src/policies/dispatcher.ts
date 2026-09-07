import type { NormalizedTool } from "./normalize";

/**
 * Policy dispatcher — single execution path for every tool call.
 *
 * Re-checks EVERYTHING at dispatch time: workspace, connector ownership,
 * current mode + version (compare-and-set race window), tool allowlist for
 * that mode, input schema, and transaction state. Nothing is pre-authorized.
 */
export interface PolicySnapshot {
  userId: string;
  connectionId: string;
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

/**
 * Connection-target argument names an LLM must never set — the SSH target and
 * credentials always come from the server-side connector, never from tool args.
 * Deliberately NARROW: legitimate RouterOS rule parameters such as `address`,
 * `ip`, `port`, `device`, `target`, or file names must stay usable (e.g.
 * `add_ip_address` requires `address`; filter rules accept `port`). The
 * per-connection MCP child is already bound to one router, so rule data args
 * cannot redirect execution elsewhere.
 */
const FORBIDDEN_ARG_NAMES = new Set([
  "host", "hostname",
  "username", "user", "password", "credential", "credentials",
]);

/**
 * Safe-mode lifecycle tools are BACKEND-ONLY: only the transaction coordinator
 * (M6 state machine) may call enable/commit/rollback. The model asking for them
 * is always denied, whatever the mode — the model never drives commit decisions.
 * `safe_mode_status` stays callable (read-only probe).
 */
const SAFE_MODE_LIFECYCLE_TOOLS = new Set(["enable_safe_mode", "commit_safe_mode", "rollback_safe_mode"]);

export class PolicyDispatcher {
  constructor(
    private deps: {
      modeSource: ModeSource;
      catalog: CatalogSource;
      validator: SchemaValidator;
      /** audit hook — never receives secrets, only decision metadata */
      audit: (event: {
        userId: string;
        connectionId: string;
        tool: string;
        decision: "allowed" | "denied";
        code?: string;
      }) => void;
    },
  ) {}

  /**
   * Decide whether a tool call may proceed. Every check happens NOW, not at
   * catalog build time, so a Write-OFF from another tab cannot be bypassed by
   * an in-flight call holding a stale snapshot.
   */
  async check(input: DispatchCheckInput): Promise<DispatchDecision> {
    const { workspace, snapshot, toolFqName, args } = input;

    if (!workspace) {
      return this.deny(snapshot, toolFqName, "FORBIDDEN", "Workspace tidak valid.");
    }
    if (workspace.userId !== snapshot.userId) {
      return this.deny(snapshot, toolFqName, "FORBIDDEN", "Workspace tidak cocok dengan connector owner.");
    }

    // 1. live mode re-check (CAS race: OFF from another tab).
    //    A no-router run ("none") is pinned to read-only + version 0: only
    //    docs tools can pass, and no connector permission row exists to race.
    //    Compare against connectorMode (the original connector mode at run start),
    //    NOT snapshot.mode (which may be downgraded by read-only intent).
    const live =
      snapshot.connectionId === "none"
        ? { mode: "read-only" as const, version: 0 }
        : await this.deps.modeSource.getMode(snapshot.userId, snapshot.connectionId);
    const expectedConnectorMode = snapshot.connectorMode ?? snapshot.mode;
    if (live.mode !== expectedConnectorMode || live.version !== snapshot.modeVersion) {
      return this.deny(snapshot, toolFqName, "POLICY_CHANGED", "Mode connector berubah selama run berlangsung. Mulai ulang percakapan.");
    }
    // effectiveMode = intersection of connector permissions and run intent.
    // runMode can only RESTRICT (never elevate) connector permissions.
    const effectiveMode = (snapshot.runMode === "read-only" || snapshot.mode === "read-only") ? "read-only" : live.mode;

    // 2. tool must exist in the catalog FOR THE CURRENT MODE
    const catalog = await this.deps.catalog.getCatalog(effectiveMode);
    const tool = catalog.find((t) => t.fqName === toolFqName);
    if (!tool) {
      return this.deny(snapshot, toolFqName, "TOOL_UNSUPPORTED", effectiveMode === "read-only"
        ? `Tool tidak tersedia dalam mode Read-Only. Untuk menjalankan perubahan, aktifkan Write dari panel connector (bukan oleh AI).`
        : `Tool tidak ditemukan dalam katalog run ini.`);
    }

    // 3. risk vs mode
    if (effectiveMode === "read-only" && tool.risk !== "read") {
      return this.deny(snapshot, toolFqName, "WRITE_DISABLED", `Mode percakapan saat ini Read-Only; tool ${tool.risk} tidak diizinkan.`);
    }
    if (tool.risk === "unknown") {
      return this.deny(snapshot, toolFqName, "TOOL_UNSUPPORTED", "Tool belum lolos review klasifikasi risiko dan tidak diizinkan.");
    }

    // 3b. safe-mode lifecycle is backend-only (transaction coordinator drives it)
    if (SAFE_MODE_LIFECYCLE_TOOLS.has(tool.rawName)) {
      return this.deny(snapshot, toolFqName, "SAFE_MODE_UNAVAILABLE", "Tool ini hanya dikelola sistem (transaction coordinator), bukan oleh AI.");
    }

    // 4. gateway tools: on read-only they can only reach read tools; the inner
    //    call is re-dispatched through check() so the effective tool+args are
    //    validated, not the outer label.
    if (tool.isGateway && effectiveMode === "read-only") {
      const inner = (args as { name?: string; arguments?: unknown } | null)?.name;
      if (!inner) {
        return this.deny(snapshot, toolFqName, "VALIDATION_FAILED", "Gateway tool memerlukan nama tool target.");
      }
      // resolve inner name against the same catalog namespace
      const prefix = toolFqName.split(":")[0];
      const innerFq = inner.includes(":") ? inner : `${prefix}:${inner}`;
      const innerTool = catalog.find((t) => t.fqName === innerFq);
      if (!innerTool || innerTool.risk !== "read") {
        return this.deny(snapshot, toolFqName, "WRITE_DISABLED", `Gateway tidak boleh memanggil tool non-read pada mode Read-Only.`);
      }
    }
    if (tool.isGateway) {
      // even in write mode, a gateway must never reach safe-mode lifecycle tools
      const inner = (args as { name?: string } | null)?.name;
      if (inner && SAFE_MODE_LIFECYCLE_TOOLS.has(inner.replace(/^.*:/, ""))) {
        return this.deny(snapshot, toolFqName, "SAFE_MODE_UNAVAILABLE", "Tool ini hanya dikelola sistem (transaction coordinator), bukan oleh AI.");
      }
    }

    // 5. schema validation of effective args
    const v = this.deps.validator.validate(tool.inputSchema, args);
    if (!v.ok) {
      return this.deny(snapshot, toolFqName, "VALIDATION_FAILED", v.message ?? "Argumen tool tidak sesuai schema.");
    }

    // 6. forbidden argument names (connection host/credential switching)
    if (args && typeof args === "object") {
      for (const key of Object.keys(args as Record<string, unknown>)) {
        if (FORBIDDEN_ARG_NAMES.has(key.toLowerCase())) {
          return this.deny(snapshot, toolFqName, "FORBIDDEN", `Argumen "${key}" tidak boleh diisi model; target diambil dari connector yang diotorisasi.`);
        }
      }
    }

    // 7. transaction state: mutations outside an active safe-mode transaction
    //    are rejected once M6 wires the real transaction manager in.
    if (effectiveMode === "write" && tool.risk !== "read" && snapshot.transactionState !== "active") {
      return this.deny(snapshot, toolFqName, "SAFE_MODE_UNAVAILABLE", "Mutasi hanya diizinkan dalam transaksi Safe Mode aktif (M6).");
    }

    this.deps.audit({ userId: snapshot.userId, connectionId: snapshot.connectionId, tool: toolFqName, decision: "allowed" });
    return { allowed: true, tool };
  }

  private deny(snapshot: PolicySnapshot, tool: string, code: string, message: string): DispatchDecision {
    this.deps.audit({ userId: snapshot.userId, connectionId: snapshot.connectionId, tool, decision: "denied", code });
    return { allowed: false, code, message };
  }
}

/**
 * Builds the catalog the model sees for a mode. Read-Only: verified read tools
 * only (upstream read-only registration ∩ annotation + Rosetta docs + custom
 * read tools). Write: everything classified read/write/destructive — nothing
 * silently dropped to shrink the request.
 */
export function buildModeCatalog(allTools: NormalizedTool[], mode: "read-only" | "write"): NormalizedTool[] {
  if (mode === "write") {
    return allTools.filter((t) => t.risk === "read" || t.risk === "write" || t.risk === "destructive");
  }
  return allTools.filter((t) => t.risk === "read");
}
