import { ROUTEROS_MENUS } from "../routeros-menus";

export type CommandRisk = "read" | "write" | "unknown";

// Comprehensive catalog of verified RouterOS menus (595 menus)
export const READ_MENUS = ROUTEROS_MENUS;
export const READ_VERBS = new Set(["print", "monitor", "export", "get", "show"]);
export const READ_COMMANDS = new Set([
  "/ping", "/traceroute", "/trace", "/export",
  "/tool ping", "/tool traceroute", "/tool trace", "/interface monitor-traffic",
]);

export const WRITE_VERBS = ["add", "remove", "set", "unset", "enable", "disable", "move", "reset", "reboot", "shutdown"];

export const FORBIDDEN_PATTERNS: RegExp[] = [
  /\/system\s+reset-configuration/i,
  /\/password/i,
  /\/user\s+(add|remove|set)/i,
  /:global\s*:/,
  /:do\s*\{/,
  /\$[a-zA-Z]/, // variables/subexpression
  /\[.*find.*\]/, // find subexpression
  /\/import/i,
  /\/tool\s+fetch/i,
  /\/system\s+script\s+(add|set|run)/i,
  /;.*\/ip\s+firewall/i, // multi-command with writes needs full review (reject by default)
];

/** Local-only commands handled by frontend, never sent to router. */
export const LOCAL_COMMANDS = new Set(["clear", "cls", "help", "history", "exit"]);
