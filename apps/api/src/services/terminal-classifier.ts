/** Controlled RouterOS command classifier. No raw host shell. */

export type CommandRisk = "read" | "write" | "unknown";

const READ_PREFIXES = [
  "/system identity print",
  "/system resource print",
  "/system clock print",
  "/system routerboard print",
  "/system package print",
  "/system history print",
  "/interface print",
  "/interface monitor",
  "/ip address print",
  "/ip route print",
  "/ip arp print",
  "/ip dhcp-server",
  "/ip dns print",
  "/ip firewall",
  "/ipv6",
  "/routing",
  "/queue",
  "/tool",
  "/log print",
  "/ping",
  "/traceroute",
  "/system script print",
  "/system scheduler print",
  "/export",
];

const WRITE_VERBS = ["add", "remove", "set", "unset", "enable", "disable", "move", "reset", "reboot", "shutdown"];

const FORBIDDEN_PATTERNS: RegExp[] = [
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

export interface ClassifiedCommand {
  raw: string;
  risk: CommandRisk;
  reason: string;
  rollbackable: boolean;
}

/** Local-only commands handled by frontend, never sent to router. */
export const LOCAL_COMMANDS = new Set(["clear", "cls", "help", "history", "exit"]);

export function isLocalCommand(cmd: string): boolean {
  return LOCAL_COMMANDS.has(cmd.trim().toLowerCase());
}

/** Normalize bare RouterOS commands (e.g. `ping 8.8.8.8` → `/ping 8.8.8.8`) for classification. */
export function normalizeBare(cmd: string): string {
  const t = cmd.trim();
  if (!t) return t;
  if (t.startsWith("/") || t.startsWith(":")) return t;
  // Bare verbs valid at RouterOS root menu — treat as absolute path.
  const bare = t.split(/\s+/)[0]!.toLowerCase();
  const knownBare = new Set([
    "ping", "traceroute", "trace", "export", "print", "monitor", "get", "find",
    "interface", "ip", "ipv6", "system", "queue", "routing", "tool", "log",
    "user", "password", "quit", "cancel",
  ]);
  if (knownBare.has(bare)) return `/${t}`;
  return t;
}

function singleRisk(cmd: string): { risk: CommandRisk; reason: string } {
  const t = cmd.trim();
  if (!t || t.startsWith("#")) return { risk: "unknown", reason: "Perintah kosong atau komentar." };
  if (isLocalCommand(t)) return { risk: "read", reason: "Perintah lokal terminal." };
  const norm = normalizeBare(t);
  if (norm.startsWith("/") === false && norm.startsWith(":") === false) {
    return { risk: "unknown", reason: `Perintah "${t.slice(0, 40)}" tidak dikenali sebagai perintah RouterOS.` };
  }
  for (const pat of FORBIDDEN_PATTERNS) {
    if (pat.test(norm)) return { risk: "unknown", reason: `Pola berisiko/dinamis ditolak: ${pat.source.slice(0, 40)}.` };
  }
  const lower = norm.toLowerCase();
  // ping/traceroute standalone are reads (with safety count injected at exec time)
  if (/^\/(ping|traceroute|trace)(\s|$)/.test(lower)) {
    return { risk: "read", reason: "Perintah baca terklasifikasi." };
  }
  if (/bandwidth-test|speed-test/i.test(lower)) {
    return { risk: "unknown", reason: "bandwidth-test ditolak di terminal (long-running & membebani link). Gunakan /interface monitor-traffic." };
  }
  // print/monitor/export/get are reads
  if (/\bprint\b|\bmonitor\b|\bexport\b|\bget\b/.test(lower) && !WRITE_VERBS.some((v) => lower.includes(` ${v} `) || lower.endsWith(` ${v}`))) {
    // Ensure it matches a known read family; otherwise unknown (don't guess).
    const known = READ_PREFIXES.some((p) => lower.startsWith(p.toLowerCase().split(" print")[0]!));
    if (known) return { risk: "read", reason: "Perintah baca terklasifikasi." };
  }
  for (const v of WRITE_VERBS) {
    if (lower.includes(` ${v} `) || lower.endsWith(` ${v}`) || lower.includes(`/${v}`)) {
      return { risk: "write", reason: `Mutasi terdeteksi (${v}).` };
    }
  }
  // Exact known reads
  if (READ_PREFIXES.some((p) => lower === p.toLowerCase() || lower.startsWith(p.toLowerCase() + " "))) {
    return { risk: "read", reason: "Perintah baca terklasifikasi." };
  }
  return { risk: "unknown", reason: "Perintah tidak dikenali; tolak daripada menebak." };
}

/** Split batch input on newlines/semicolons outside quotes (best-effort, strict on ambiguity). */
export function splitBatch(input: string): string[] {
  const parts: string[] = [];
  let cur = "";
  let inQuote = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!;
    if (ch === '"') inQuote = !inQuote;
    if (!inQuote && (ch === "\n" || ch === ";")) {
      if (cur.trim()) parts.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts.slice(0, 20);
}

/**
 * Safety defaults so one-shot SSH exec terminates instead of hanging forever.
 * - /ping without count= → append count=4 (default RouterOS ping runs until Ctrl+C)
 * - /traceroute without count → append count=1 is NOT valid; use default timeout instead.
 * - /interface monitor-traffic without duration → append duration=5
 * Returns { command, injected } for honest display.
 */
export function applySafetyDefaults(raw: string): { command: string; injected: string | null } {
  const norm = normalizeBare(raw.trim());
  const lower = norm.toLowerCase();
  if (/^\/(ping)(\s|$)/.test(lower) && !/\bcount\s*=/i.test(norm)) {
    return { command: `${norm} count=4`, injected: "count=4 (otomatis agar tidak hang)" };
  }
  if (/monitor-traffic/.test(lower) && !/\bduration\s*=/i.test(norm)) {
    return { command: `${norm} duration=5`, injected: "duration=5 (otomatis)" };
  }
  if (/^\/(tool\s+)?(bandwidth-test|speed-test)/.test(lower)) {
    // bandwidth-test is long-running & heavy — refuse with guidance instead of hanging.
    return { command: norm, injected: null };
  }
  // Bare form: execute normalized absolute form.
  if (norm !== raw.trim()) return { command: norm, injected: null };
  return { command: norm, injected: null };
}

export function classifyBatch(input: string): { commands: ClassifiedCommand[]; overall: CommandRisk; blocked: string | null } {
  const raws = splitBatch(input);
  if (raws.length === 0) return { commands: [], overall: "unknown", blocked: "Tidak ada perintah yang dapat dijalankan." };
  if (raws.length > 10) return { commands: [], overall: "unknown", blocked: "Batch maksimal 10 perintah per submit." };
  const commands: ClassifiedCommand[] = raws.map((raw) => {
    const { risk, reason } = singleRisk(raw);
    // Safe Mode rollback assumption: only simple add/set/remove on known paths are considered handled;
    // script/system-level mutasi ditolak di singleRisk sebagai unknown.
    const rollbackable = risk === "read" ? true : risk === "write" ? !/reset|reboot|shutdown/i.test(raw) : false;
    return { raw, risk, reason, rollbackable };
  });
  const unknown = commands.find((c) => c.risk === "unknown");
  if (unknown) return { commands, overall: "unknown", blocked: `Perintah ditolak: "${unknown.raw.slice(0, 80)}" — ${unknown.reason}` };
  const nonRollback = commands.find((c) => c.risk === "write" && !c.rollbackable);
  if (nonRollback) {
    return { commands, overall: "unknown", blocked: `Perintah tidak dapat di-rollback aman: "${nonRollback.raw.slice(0, 80)}".` };
  }
  const overall: CommandRisk = commands.some((c) => c.risk === "write") ? "write" : "read";
  return { commands, overall, blocked: null };
}
