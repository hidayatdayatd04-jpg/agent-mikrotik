/** Deliberately narrow: a greeting with any actual request still reaches tools. */
export function isGreetingOnly(text: string): boolean {
  return /^(halo|hallo|hai|hi|hello|hey|hei|assalamualaikum|assalamu'alaikum|selamat (pagi|siang|sore|malam))(\s+(min|admin|kak|bang|pak|bu|bot))?[\s!?.👋]*$/iu.test(text.trim());
}

/**
 * Detects whether a request is intended as read-only / inspection / command review,
 * or explicitly forbids modifying the router directly.
 * When true, the run is restricted to read-only even if the connector has Write enabled.
 *
 * Classification rules (in priority order):
 * 1. Explicit read-only directives ("hanya baca", "read-only", "dry-run",
 *    "tampilkan perintah") → read-only.
 * 2. Action verb at the START of the request determines intent:
 *    - Inspection verbs ("cek", "lihat", "analisa") + any target noun → read-only.
 *    - Mutation verbs ("tambahkan", "ubah", "hapus") → write, even if prohibition
 *      clauses follow (e.g. "jangan hapus aturan lama" is a constraint, not intent).
 * 3. No clear action verb → fallback: check if inspection keywords are present.
 */
export function isReadOnlyIntent(text: string): boolean {
  const t = text.toLowerCase().trim();
  if (!t) return false;

  // 1. Explicit read-only directives override any other phrasing
  const explicitReadOnlyDirectives = [
    /\bhanya\s+baca\b/i,
    /\bread[\s-_]?only\b/i,
    /\bdry[\s-_]?run\b/i,
    /\btampilkan\s+perintah(\s+(untuk|yang\s+harus)\s+saya\s+jalankan)?\b/i,
    /\btampilkan\s+(script|command|cli|konfigurasi)\b/i,
    /\bberikan\s+(perintah|script|command|konfigurasi)\b/i,
    /\brekomendasi\s+(perintah|script|konfigurasi)\b/i,
    /\bdo\s+not\s+(modify|change|write|execute|apply)\b/i,
    /\bdon'?t\s+(modify|change|write|execute|apply)\b/i,
  ];
  if (explicitReadOnlyDirectives.some((p) => p.test(t))) {
    return true;
  }

  // 2. Blanket prohibition of ALL direct changes (not just specific operations)
  //    "jangan melakukan konfigurasi langsung", "tanpa mengubah apapun"
  const blanketProhibitions = [
    /\bjangan\s+(melakukan\s+)?(konfigurasi|perubahan|modifikasi)\s+(langsung|melalui|via|lewat)\b/i,
    /\btanpa\s+(mengubah|modifikasi|perubahan)\s+(apapun|apa\s*pun|sama\s*sekali)\b/i,
    /\bjangan\s+(ubah|modifikasi|eksekusi|tulis|edit)\s+(apapun|apa\s*pun|semua)\b/i,
  ];
  if (blanketProhibitions.some((p) => p.test(t))) {
    return true;
  }

  // 3. Detect primary ACTION VERB — the first verb determines intent.
  //    Prohibition clauses ("jangan hapus X") are constraints on a mutation,
  //    NOT the primary intent. They appear AFTER the primary verb.
  //    Example: "tambahkan rule firewall, jangan hapus aturan lama"
  //             → primary verb = "tambahkan" (mutation), constraint = "jangan hapus"

  // Mutation verbs: user wants the system to apply changes
  const mutationVerbPatterns = [
    /\b(tambah|tambahkan|add|create|buat|pasang|install)\b/i,
    /\b(ubah|modifikasi|ganti|update|modify|change|edit|perbaiki|fix|benerin)\b/i,
    /\b(hapus|delete|remove|drop)\b/i,
    /\b(enable|aktifkan|disable|nonaktifkan)\b/i,
    /\b(konfigurasikan|setting|setup|apply|terapkan)\b/i,
    /\b(reboot|restart|reset)\b/i,
    /\bset\s+\w/i,
  ];

  // Inspection verbs: user wants to view/check/analyze
  const inspectionVerbPatterns = [
    /\b(jelaskan|tampilkan|terhubung\s+ke)\b/i,
    /\b(cek|periksa|lihat|analisa|analisis|audit|pantau|monitoring|baca)\b/i,
    /\b(check|inspect|show|view|read|list|print|monitor|review|examine)\b/i,
    /\b(bagaimana\s+kondisi|ada\s+apa|kenapa|mengapa)\b/i,
    /\b(status|info|informasi)\s/i,
  ];

  // Compound intention: user wants inspection followed by mutation
  // e.g. "cek lalu perbaiki", "periksa dan tambahkan", "analisis kemudian ubah"
  const compoundMutationPattern =
    /\b(dan|lalu|kemudian|terus|setelah\s+itu|and|then)\s+(?:tolong\s+)?(?:coba\s+)?(?:bisa\s+)?(tambah|tambahkan|add|create|buat|pasang|install|ubah|modifikasi|ganti|update|modify|change|edit|perbaiki|fix|benerin|hapus|delete|remove|enable|aktifkan|disable|nonaktifkan|konfigurasikan|setting|setup|apply|terapkan)\b/i;
  if (compoundMutationPattern.test(t)) {
    return false;
  }

  // Find first match position for each category
  const firstMutationMatch = mutationVerbPatterns.reduce((earliest, p) => {
    const m = p.exec(t);
    return m && (earliest === -1 || m.index < earliest) ? m.index : earliest;
  }, -1);

  const firstInspectionMatch = inspectionVerbPatterns.reduce((earliest, p) => {
    const m = p.exec(t);
    return m && (earliest === -1 || m.index < earliest) ? m.index : earliest;
  }, -1);

  // If both found, the EARLIER one wins (primary intent comes first in natural language)
  if (firstMutationMatch !== -1 && firstInspectionMatch !== -1) {
    return firstInspectionMatch < firstMutationMatch;
  }
  if (firstMutationMatch !== -1) return false;
  if (firstInspectionMatch !== -1) return true;

  // 4. Fallback: no clear verb — check for general inquiry patterns
  //    Words like "konfigurasi" are target nouns, not verbs — they don't indicate mutation
  const inquiryPatterns = [
    /\bapa\s+(saja|itu)\b/i,
    /\bberapa\b/i,
    /\bsepertinya\b/i,
    /\bapakah\b/i,
  ];
  return inquiryPatterns.some((p) => p.test(t));
}
