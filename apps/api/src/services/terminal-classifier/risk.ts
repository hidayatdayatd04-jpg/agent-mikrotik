import {
  FORBIDDEN_PATTERNS,
  READ_COMMANDS,
  READ_MENUS,
  READ_VERBS,
  WRITE_VERBS,
  type CommandRisk,
} from "./patterns";
import { isLocalCommand, normalizeBare } from "./normalize";

export function singleRisk(cmd: string): { risk: CommandRisk; reason: string } {
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
  // Dynamic expressions and ambiguous quoting cannot be validated by this simple runner.
  if (/[\[\]{}\\]/.test(norm) || (norm.match(/"/g)?.length ?? 0) % 2 !== 0) {
    return { risk: "unknown", reason: "Ekspresi dinamis atau kutipan ambigu ditolak." };
  }
  if (/bandwidth-test|speed-test/i.test(lower)) {
    return { risk: "unknown", reason: "bandwidth-test ditolak di terminal (long-running & membebani link). Gunakan /interface monitor-traffic." };
  }
  for (const v of WRITE_VERBS) {
    if (lower.includes(` ${v} `) || lower.endsWith(` ${v}`) || lower.includes(`/${v}`)) {
      return { risk: "write", reason: `Mutasi terdeteksi (${v}).` };
    }
  }
  // Match the operation immediately after an exact menu, never words in argument values.
  // print/export file= writes a router file and is outside this read-only whitelist.
  if (/(?:^|\s)file\s*=/.test(lower)) {
    return { risk: "unknown", reason: "Penulisan file router tidak diizinkan sebagai perintah baca." };
  }
  const words = lower.split(/\s+/);
  for (let i = 0; i < words.length; i++) {
    const path = words.slice(0, i + 1).join(" ");
    const menu = words.slice(0, i).join(" ");
    if (READ_COMMANDS.has(path) || (READ_MENUS.has(menu) && READ_VERBS.has(words[i]!))) {
      return { risk: "read", reason: "Perintah baca terklasifikasi." };
    }
  }
  return { risk: "unknown", reason: "Perintah tidak dikenali; tolak daripada menebak." };
}
