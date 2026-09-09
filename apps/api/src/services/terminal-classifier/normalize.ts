import { ROUTEROS_ROOTS, ROUTEROS_ROOT_COMMANDS } from "../routeros-menus";
import { LOCAL_COMMANDS } from "./patterns";

export { LOCAL_COMMANDS } from "./patterns";

export function isLocalCommand(cmd: string): boolean {
  return LOCAL_COMMANDS.has(cmd.trim().toLowerCase());
}

/** Normalize slash-path notation (e.g. `/interface/vlan/print` → `/interface vlan print`). */
export function normalizeSlashes(cmd: string): string {
  const parts = cmd.trim().split(/\s+/);
  if (!parts[0]?.startsWith("/")) return cmd;
  const firstToken = parts[0];
  if (firstToken.includes("/", 1)) {
    const subWords = firstToken.split("/").filter(Boolean);
    const normalizedFirst = "/" + subWords.join(" ");
    return [normalizedFirst, ...parts.slice(1)].join(" ");
  }
  return cmd;
}

/** Normalize bare RouterOS commands (e.g. `ping 8.8.8.8` → `/ping 8.8.8.8`) for classification. */
export function normalizeBare(cmd: string): string {
  const t = cmd.trim();
  if (!t) return t;
  if (t.startsWith("/") || t.startsWith(":")) return normalizeSlashes(t);
  // Bare verbs valid at RouterOS root menu — treat as absolute path.
  const bare = t.split(/\s+/)[0]!.toLowerCase();
  if (ROUTEROS_ROOTS.has(bare) || ROUTEROS_ROOT_COMMANDS.has(bare)) {
    return normalizeSlashes(`/${t}`);
  }
  return t;
}
