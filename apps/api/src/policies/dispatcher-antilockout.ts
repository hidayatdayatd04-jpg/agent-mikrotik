import type { NormalizedTool } from "./normalize";
import type { PolicySnapshot } from "./dispatcher-types";

/**
 * Anti-lockout guard ( BUTIR 6.5 dispatch ): forbid disabling or removing
 * management interface/IP or SSH service — jalur koneksi aktif agen tidak
 * boleh diputus oleh tool.
 */
export function checkAntiLockout(
  snapshot: PolicySnapshot,
  tool: NormalizedTool,
  args: unknown,
): { code: string; message: string } | null {
  if (snapshot.managementInterface || snapshot.connectionHost) {
    const mgmtIface = snapshot.managementInterface?.toLowerCase();
    const mgmtHost = snapshot.connectionHost?.toLowerCase();

    // Check raw commands
    if (tool.rawName === "run_routeros_command" || tool.rawName === "run_command" || tool.rawName === "execute_command") {
      const cmd = String((args as { command?: unknown } | null)?.command ?? "").trim().toLowerCase();

      // Blocking disabling SSH service
      if (/^\/?ip\s+service\s+(set\b.*ssh.*disabled=yes|disable\b.*ssh)/i.test(cmd)) {
        return { code: "FORBIDDEN", message: "Ditolak untuk mencegah lockout: Menonaktifkan service SSH akan memutus koneksi manajemen." };
      }

      // Blocking disabling/removing management interface
      if (mgmtIface) {
        const ifaceRegex = new RegExp(`^\\/?interface\\s+(set\\b.*disabled=yes|disable\\b).*\\b${mgmtIface}\\b`, "i");
        if (ifaceRegex.test(cmd) || (cmd.includes(mgmtIface) && /^\/?interface\s+(disable|set\b.*disabled=yes)/i.test(cmd))) {
          return {
            code: "FORBIDDEN",
            message: `Perintah ditolak untuk mencegah lockout: Interface "${snapshot.managementInterface}" adalah jalur koneksi aktif agen (${snapshot.connectionHost ?? "router"}). Menonaktifkannya akan memutus komunikasi secara permanen. Untuk mematikan internet dengan aman, pasang firewall filter drop di chain forward (contoh: /ip firewall filter add chain=forward action=drop comment="Blokir internet klien").`,
          };
        }
      }

      // Blocking disabling/removing connection IP
      if (mgmtHost) {
        if (cmd.includes(mgmtHost) && /^\/?ip\s+address\s+(disable|remove|set\b.*disabled=yes)/i.test(cmd)) {
          return {
            code: "FORBIDDEN",
            message: `Perintah ditolak untuk mencegah lockout: Alamat IP "${snapshot.connectionHost}" adalah IP koneksi aktif agen.`,
          };
        }
      }
    }

    // Check structured tools
    if (mgmtIface) {
      const a = (args ?? {}) as Record<string, unknown>;
      const targetIface = String(a.interface ?? a.name ?? a.interface_name ?? "").toLowerCase();
      const isDisabling = a.disabled === true || a.disabled === "yes" || tool.rawName.includes("disable");
      if (tool.rawName.includes("interface") && targetIface === mgmtIface && isDisabling) {
        return {
          code: "FORBIDDEN",
          message: `Operasi ditolak untuk mencegah lockout: Interface "${snapshot.managementInterface}" adalah jalur koneksi aktif agen (${snapshot.connectionHost ?? "router"}). Untuk mematikan internet, pasang firewall filter drop pada chain forward.`,
        };
      }
    }
  }
  return null;
}
