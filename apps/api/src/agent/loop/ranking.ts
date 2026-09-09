import type { NormalizedTool } from "../../policies/normalize";
import { CONNECTION_CHECK_FQ } from "./connection";
import { extractQueryKeywords } from "./ranking-synonyms";

/**
 * Batas tool per request agar payload tidak membengkak. Di bawah batas,
 * SELURUH katalog dikirim (tanpa pengurangan kemampuan). Di atas batas,
 * connection probe + docs selalu dipertahankan, sisanya dirangking oleh
 * relevansi kata kunci terhadap pesan pengguna.
 */
export const MAX_PROVIDER_TOOLS = 48;
/** Batas ukuran total schema per request (~17rb token estimasi) agar payload tidak membengkak. */
export const MAX_PROVIDER_SCHEMA_CHARS = 60_000;

function schemaChars(t: NormalizedTool): number {
  let schemaLen = 0;
  try {
    schemaLen = JSON.stringify(t.inputSchema ?? {}).length;
  } catch {
    schemaLen = 500;
  }
  return (t.description?.length ?? 0) + schemaLen + (t.fqName?.length ?? 0);
}

const CORE_ROUTER_READ_TOOLS = new Set([
  "list_interfaces",
  "list_ip_addresses",
  "list_routes",
  "get_dhcp_clients",
  "list_dhcp_servers",
  "list_firewall_rules",
  "list_firewall_nat",
  "get_system_resource",
  "print_system_resource",
  "system_identity",
]);

/** Skor relevansi satu tool terhadap kata kunci (dipakai ranking + budget deskripsi). */
export function scoreToolForQuery(t: NormalizedTool, keywords: Set<string>): number {
  if (t.fqName === CONNECTION_CHECK_FQ) return 1_000_000;
  if (CORE_ROUTER_READ_TOOLS.has(t.rawName)) return 600_000;
  const hay = `${t.fqName} ${t.description} ${(t.capabilities ?? []).join(" ")}`.toLowerCase();
  let s = 0;
  for (const kw of keywords) {
    if (hay.includes(kw)) s += kw.length >= 5 ? 200 : 100;
  }
  if (t.fqName.startsWith("docs:") || t.fqName.startsWith("web:")) s += 5_000;
  return s;
}

export function selectRelevantTools(catalog: NormalizedTool[], userText: string): NormalizedTool[] {
  const totalSchema = catalog.reduce((n, t) => n + schemaChars(t), 0);
  if (catalog.length <= MAX_PROVIDER_TOOLS && totalSchema <= MAX_PROVIDER_SCHEMA_CHARS) return catalog;
  const keywords = extractQueryKeywords(userText);
  // Rangking menurun, isi rakus sampai batas jumlah ATAU ukuran schema —
  // probe koneksi selalu ikut walau budget ketat.
  const ranked = [...catalog]
    .map((t, i) => ({ t, s: scoreToolForQuery(t, keywords), i }))
    .sort((a, b) => b.s - a.s || a.i - b.i);
  const picked: typeof ranked = [];
  let chars = 0;
  for (const e of ranked) {
    if (picked.length >= MAX_PROVIDER_TOOLS) break;
    const c = schemaChars(e.t);
    if (e.t.fqName !== CONNECTION_CHECK_FQ && chars + c > MAX_PROVIDER_SCHEMA_CHARS) continue;
    picked.push(e);
    chars += c;
  }
  if (!picked.some((e) => e.t.fqName === CONNECTION_CHECK_FQ)) {
    const probe = ranked.find((e) => e.t.fqName === CONNECTION_CHECK_FQ);
    if (probe) picked.push(probe);
  }
  return picked
    .sort((a, b) => a.i - b.i)
    .map((e) => e.t);
}

export function canonicalKey(fq: string, args: unknown): string {
  if (fq.includes("find_tools") || fq.includes("routeros_search")) {
    if (args && typeof args === "object") {
      const rawQuery = String((args as Record<string, unknown>).query ?? (args as Record<string, unknown>).search ?? "").toLowerCase();
      const normalizedQuery = rawQuery
        .replace(/\b(print|detail|list|export|show|get)\b/g, "")
        .replace(/[^a-z0-9_-]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      return `${fq}\n${JSON.stringify({ query: normalizedQuery || rawQuery })}`;
    }
  }
  try {
    const sortObj = (val: unknown): unknown => {
      if (val === null || typeof val !== "object") return val;
      if (Array.isArray(val)) return val.map(sortObj);
      const sorted: Record<string, unknown> = {};
      for (const k of Object.keys(val as Record<string, unknown>).sort()) {
        sorted[k] = sortObj((val as Record<string, unknown>)[k]);
      }
      return sorted;
    };
    return `${fq}\n${JSON.stringify(sortObj(args))}`;
  } catch {
    return `${fq}\n${JSON.stringify(args)}`;
  }
}

/**
 * Alihkan discovery yang tidak perlu ke tool langsung: bila kueri find_tools
 * jelas cocok dengan tool non-discovery yang SUDAH ada di katalog run ini,
 * kembalikan daftar tool langsung tanpa eksekusi pencarian — menghemat
 * round-trip AI dan menuntun model memakai pembacaan langsung.
 */
export function findDirectToolsForQuery(query: unknown, catalog: NormalizedTool[]): NormalizedTool[] {
  const raw = String(query ?? "").toLowerCase();
  const normalized = raw
    .replace(/\b(print|detail|list|export|show|get)\b/g, "")
    .replace(/[^a-z0-9_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return [];
  const tokens = normalized.split(" ").filter((w) => w.length >= 4);
  const out: NormalizedTool[] = [];
  for (const t of catalog) {
    if (t.fqName.includes("find_tools") || t.fqName.includes("routeros_search")) continue;
    const nameSpaced = t.rawName.toLowerCase().replace(/_/g, " ");
    const nameFlat = t.rawName.toLowerCase().replace(/_/g, "");
    const queryFlat = normalized.replace(/ /g, "");
    if (nameSpaced.includes(normalized) || normalized.includes(nameSpaced) || nameFlat.includes(queryFlat) || queryFlat.includes(nameFlat)) {
      out.push(t);
      continue;
    }
    const hayTokens = new Set(`${t.rawName} ${(t.capabilities ?? []).join(" ")}`.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
    if (tokens.some((tok) => hayTokens.has(tok))) out.push(t);
  }
  return out.slice(0, 5);
}
