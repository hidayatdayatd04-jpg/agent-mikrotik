import type { NormalizedTool } from "./normalize";

/**
 * Policy dispatcher — single execution path for every tool call.
 *
 * Re-checks EVERYTHING at dispatch time: session, connector ownership,
 * current mode + version (compare-and-set race window), tool allowlist for
 * that mode, input schema, and transaction state. Nothing is pre-authorized.
 */
export interface PolicySnapshot {
  userId: string;
  connectionId: string;
  /** mode/version as of the moment the agent run started */
  mode: "read-only" | "write";
  modeVersion: number;
  /** transaction state on this connection (M6) */
  transactionState: "none" | "active";
}

export interface ModeSource {
  /** live mode + version from the permissions table (not a cached copy) */
  getMode(userId: string, connectionId: string): Promise<{ mode: "read-only" | "write"; version: number }>;
}

export interface DispatchCheckInput {
  session: { userId: string } | null;
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

/** Sensitive argument names an LLM must never set — they come from connector context only. */
const FORBIDDEN_ARG_NAMES = new Set([
  "host", "hostname", "ip", "address", "port",
  "username", "user", "password", "credential", "credentials",
  "device", "target", "path", "filepath", "localpath", "tenant",
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
    const { session, snapshot, toolFqName, args } = input;

    if (!session) {
      return this.deny(snapshot, toolFqName, "AUTH_REQUIRED", "Sesi tidak valid.");
    }
    if (session.userId !== snapshot.userId) {
      return this.deny(snapshot, toolFqName, "FORBIDDEN", "Sesi tidak cocok dengan connector owner.");
    }

    // 1. live mode re-check (CAS race: OFF from another tab).
    //    A no-router run ("none") is pinned to read-only + version 0: only
    //    docs tools can pass, and no connector permission row exists to race.
    const live =
      snapshot.connectionId === "none"
        ? { mode: "read-only" as const, version: 0 }
        : await this.deps.modeSource.getMode(snapshot.userId, snapshot.connectionId);
    if (live.mode !== snapshot.mode || live.version !== snapshot.modeVersion) {
      return this.deny(snapshot, toolFqName, "POLICY_CHANGED", "Mode connector berubah selama run berlangsung. Mulai ulang percakapan.");
    }
    if (live.mode === "read-only") {
      // any mutation attempt is dead here — even before tool lookup
    }

    // 2. tool must exist in the catalog FOR THE CURRENT MODE
    const catalog = await this.deps.catalog.getCatalog(live.mode);
    const tool = catalog.find((t) => t.fqName === toolFqName);
    if (!tool) {
      return this.deny(snapshot, toolFqName, "TOOL_UNSUPPORTED", live.mode === "read-only"
        ? `Tool tidak tersedia dalam mode Read-Only. Untuk menjalankan perubahan, aktifkan Write dari panel connector (bukan oleh AI).`
        : `Tool tidak ditemukan dalam katalog run ini.`);
    }

    // 3. risk vs mode
    if (live.mode === "read-only" && tool.risk !== "read") {
      return this.deny(snapshot, toolFqName, "WRITE_DISABLED", `Mode Read-Only aktif; tool ${tool.risk} tidak diizinkan.`);
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
    if (tool.isGateway && live.mode === "read-only") {
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

    // 6. forbidden argument names (device/host/credential switching)
    if (args && typeof args === "object") {
      for (const key of Object.keys(args as Record<string, unknown>)) {
        if (FORBIDDEN_ARG_NAMES.has(key.toLowerCase())) {
          return this.deny(snapshot, toolFqName, "FORBIDDEN", `Argumen "${key}" tidak boleh diisi model; target diambil dari connector yang diotorisasi.`);
        }
      }
    }

    // 7. transaction state: mutations outside an active safe-mode transaction
    //    are rejected once M6 wires the real transaction manager in.
    if (live.mode === "write" && tool.risk !== "read" && snapshot.transactionState !== "active") {
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
