import { normalizeBare } from "./terminal-classifier/normalize";
import { singleRisk } from "./terminal-classifier/risk";
import type { CommandRisk } from "./terminal-classifier/patterns";

export type { CommandRisk } from "./terminal-classifier/patterns";
export { LOCAL_COMMANDS, isLocalCommand, normalizeSlashes, normalizeBare } from "./terminal-classifier/normalize";

export interface ClassifiedCommand {
  raw: string;
  risk: CommandRisk;
  kind?: CommandRisk;
  reason: string;
  rollbackable: boolean;
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
    return { raw, risk, kind: risk, reason, rollbackable };
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
