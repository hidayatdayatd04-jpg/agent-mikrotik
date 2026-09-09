import type { ChatToolDefinition } from "../chat-client";
import type { NormalizedTool } from "../../policies/normalize";
import { extractQueryKeywords } from "./ranking-synonyms";
import { scoreToolForQuery } from "./ranking";

/** Tool paling relevan boleh membawa deskripsi jauh lebih lengkap. */
const FULL_DESC_TOOLS = 12;
const FULL_DESC_CHARS = 1200;
const SHORT_DESC_CHARS = 300;

/**
 * Potong teks pada batas kalimat (fallback batas kata, lalu potong keras).
 * Deskripsi tool yang terpotong tengah kalimat membuat model salah paham
 * parameter — sumber klasik pemanggilan tool "bodoh".
 */
export function cutAtBoundary(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const slice = text.slice(0, limit);
  const marks = [
    slice.lastIndexOf(". "),
    slice.lastIndexOf(".\n"),
    slice.lastIndexOf("? "),
    slice.lastIndexOf("!\n"),
    slice.lastIndexOf("\n"),
  ];
  const cut = Math.max(...marks);
  // Batas kalimat diterima bila masih membawa ≥30% budget — kalimat utuh
  // pendek lebih berguna daripada potongan panjang yang menggantung.
  if (cut >= limit * 0.3) return slice.slice(0, cut + 1).trimEnd();
  const space = slice.lastIndexOf(" ");
  if (space > limit * 0.5) return slice.slice(0, space);
  return slice;
}

export function toProviderTools(catalog: NormalizedTool[], userText = ""): ChatToolDefinition[] {
  const keywords = extractQueryKeywords(userText);
  const scored = catalog.map((t) => ({ t, s: keywords.size > 0 ? scoreToolForQuery(t, keywords) : 0 }));
  const fullSet = new Set(
    [...scored]
      .sort((a, b) => b.s - a.s)
      .filter((e) => e.s > 0)
      .slice(0, FULL_DESC_TOOLS)
      .map((e) => e.t.fqName),
  );
  return catalog.map((t) => {
    let desc = t.description;
    if (t.rawName === "find_tools") {
      desc = "Cari tool di katalog hanya jika kemampuan yang dibutuhkan belum tersedia di daftar tools saat ini. Jangan panggil tool ini jika tool yang Anda cari (seperti list_interfaces, list_ip_addresses, dll) sudah ada di daftar.";
    }
    // Budget deskripsi berdasar relevansi: tool yang cocok dengan kueri membawa
    // deskripsi utuh (hemat token tetap terjaga karena hanya 12 teratas);
    // sisanya ringkas. Web (Deep Research) selalu utuh — protokol risetnya
    // wajib terlihat model agar mau mengiterasi pencarian.
    const budget = t.fqName.startsWith("web:")
      ? 2000
      : fullSet.has(t.fqName) ? FULL_DESC_CHARS : SHORT_DESC_CHARS;
    return {
      type: "function" as const,
      function: {
        name: t.fqName.replace(/[^A-Za-z0-9_-]/g, "_"),
        description: cutAtBoundary(desc, budget),
        parameters: (t.inputSchema && typeof t.inputSchema === "object"
          ? (t.inputSchema as Record<string, unknown>)
          : { type: "object", properties: {} }),
      },
    };
  });
}
