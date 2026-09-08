import { findForbiddenArg } from "./dispatcher-args";
import { checkAntiLockout } from "./dispatcher-antilockout";
import { checkGatewayRules } from "./dispatcher-gateway";
import type { CatalogSource, DispatchCheckInput, DispatchDecision, ModeSource, PolicySnapshot, SchemaValidator } from "./dispatcher-types";

export type {
  CatalogSource,
  DispatchCheckInput,
  DispatchDecision,
  ModeSource,
  PolicySnapshot,
  SchemaValidator,
} from "./dispatcher-types";
export { buildModeCatalog } from "./dispatcher-catalog";

/**
 * Policy dispatcher — single execution path for every tool call.
 *
 * Re-checks EVERYTHING at dispatch time: workspace, connector ownership,
 * current mode + version (compare-and-set race window), tool allowlist for
 * that mode, input schema, and transaction state. Nothing is pre-authorized.
 */
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
    let args = input.args;
    if (
      args &&
      typeof args === "object" &&
      !Array.isArray(args) &&
      !("name" in (args as Record<string, unknown>)) &&
      "arguments" in (args as Record<string, unknown>) &&
      typeof (args as Record<string, unknown>).arguments === "object" &&
      (args as Record<string, unknown>).arguments !== null &&
      !Array.isArray((args as Record<string, unknown>).arguments)
    ) {
      args = (args as Record<string, unknown>).arguments;
    }
    const { workspace, snapshot, toolFqName } = input;

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

    // 3b + 4. safe-mode lifecycle & gateway rules
    const gw = checkGatewayRules(tool, toolFqName, args, catalog, effectiveMode);
    if (gw) return this.deny(snapshot, toolFqName, gw.code, gw.message);

    // 5. schema validation of effective args
    const v = this.deps.validator.validate(tool.inputSchema, args);
    if (!v.ok) {
      return this.deny(snapshot, toolFqName, "VALIDATION_FAILED", v.message ?? "Argumen tool tidak sesuai schema.");
    }

    // 6. forbidden argument names (connection host/credential switching) checked recursively
    if (args && typeof args === "object") {
      const forbidden = findForbiddenArg(args);
      if (forbidden) {
        return this.deny(snapshot, toolFqName, "FORBIDDEN", `Argumen "${forbidden}" tidak boleh diisi model; target diambil dari connector yang diotorisasi.`);
      }
    }

    // 6.5. Anti-lockout guard: forbid disabling or removing management interface/IP or SSH service
    const lockout = checkAntiLockout(snapshot, tool, args);
    if (lockout) return this.deny(snapshot, toolFqName, lockout.code, lockout.message);

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
