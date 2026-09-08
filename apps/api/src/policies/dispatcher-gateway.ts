import type { NormalizedTool } from "./normalize";

/**
 * Safe-mode lifecycle tools are BACKEND-ONLY: only the transaction coordinator
 * (M6 state machine) may call enable/commit/rollback. The model asking for them
 * is always denied, whatever the mode — the model never drives commit decisions.
 * `safe_mode_status` stays callable (read-only probe).
 */
const SAFE_MODE_LIFECYCLE_TOOLS = new Set(["enable_safe_mode", "commit_safe_mode", "rollback_safe_mode"]);

export interface GatewayDenial {
  code: string;
  message: string;
}

/**
 * Aturan gateway + safe-mode-lifecycle ( BUTIR 3b & 4 dispatch ). Mengembalikan
 * denial bila ditolak, `null` bila lolos ke pemeriksaan berikutnya.
 */
export function checkGatewayRules(
  tool: NormalizedTool,
  toolFqName: string,
  args: unknown,
  catalog: NormalizedTool[],
  effectiveMode: "read-only" | "write",
): GatewayDenial | null {
  // 3b. safe-mode lifecycle is backend-only (transaction coordinator drives it)
  if (SAFE_MODE_LIFECYCLE_TOOLS.has(tool.rawName)) {
    return { code: "SAFE_MODE_UNAVAILABLE", message: "Tool ini hanya dikelola sistem (transaction coordinator), bukan oleh AI." };
  }

  // 4. gateway tools: on read-only they can only reach read tools; the inner
  //    call is re-dispatched through check() so the effective tool+args are
  //    validated, not the outer label.
  if (tool.isGateway && effectiveMode === "read-only") {
    const isInvokeTool = tool.rawName === "invoke_tool";
    if (isInvokeTool) {
      const inner = (args as { name?: string; arguments?: unknown } | null)?.name;
      if (!inner) {
        return { code: "VALIDATION_FAILED", message: "Gateway tool memerlukan nama tool target." };
      }
      // resolve inner name against the same catalog namespace
      const prefix = toolFqName.split(":")[0];
      const innerFq = inner.includes(":") ? inner : `${prefix}:${inner}`;
      const innerTool = catalog.find((t) => t.fqName === innerFq)
        ?? catalog.find((t) => t.rawName === inner.replace(/^.*:/, ""));
      if (!innerTool) {
        // Nama tak dikenal di katalog read-only: bukan soal mode tulis —
        // model salah nama. WRITE_DISABLED di sini menyesatkan (meminta
        // toggle Write untuk typo), jadi tolak sebagai TOOL_UNSUPPORTED.
        return { code: "TOOL_UNSUPPORTED", message: `Tool target "${inner}" tidak dikenal dalam katalog run ini. Pilih nama tool dari daftar yang tersedia, jangan mengarang nama.` };
      }
      if (innerTool.risk !== "read") {
        return { code: "WRITE_DISABLED", message: `Gateway tidak boleh memanggil tool non-read pada mode Read-Only.` };
      }
    } else {
      return { code: "WRITE_DISABLED", message: "Eksekusi command CLI langsung tidak diizinkan pada mode Read-Only." };
    }
  }
  if (tool.isGateway) {
    // even in write mode, a gateway must never reach safe-mode lifecycle tools
    const inner = (args as { name?: string } | null)?.name;
    if (inner && SAFE_MODE_LIFECYCLE_TOOLS.has(inner.replace(/^.*:/, ""))) {
      return { code: "SAFE_MODE_UNAVAILABLE", message: "Tool ini hanya dikelola sistem (transaction coordinator), bukan oleh AI." };
    }
    if (tool.rawName === "run_routeros_command" || tool.rawName === "run_command" || tool.rawName === "execute_command") {
      const cmd = String((args as { command?: unknown } | null)?.command ?? "").trim().toLowerCase();
      if (/safe[-_]?mode/i.test(cmd)) {
        return { code: "SAFE_MODE_UNAVAILABLE", message: "Safe mode hanya dikelola koordinator transaksi." };
      }
    }
    // Unknown inner tool names (e.g. model mengarang "mt_run_routeros_command")
    // ditolak sebelum eksekusi — MCP hanya mengembalikan teks error yang
    // terlihat sukses sehingga model mengulanginya tanpa kemajuan.
    if (inner) {
      const prefix = toolFqName.split(":")[0];
      const innerFq = inner.includes(":") ? inner : `${prefix}:${inner}`;
      const known = catalog.some((t) => t.fqName === innerFq)
        || catalog.some((t) => t.rawName === inner.replace(/^.*:/, ""));
      if (!known) {
        return { code: "TOOL_UNSUPPORTED", message: `Tool target "${inner}" tidak dikenal dalam katalog run ini. Pilih nama tool dari daftar yang tersedia, jangan mengarang nama atau menambah prefix.` };
      }
    }
  }
  return null;
}
