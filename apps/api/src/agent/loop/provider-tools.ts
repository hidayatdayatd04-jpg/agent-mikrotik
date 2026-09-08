import type { ChatToolDefinition } from "../chat-client";
import type { NormalizedTool } from "../../policies/normalize";

export function toProviderTools(catalog: NormalizedTool[]): ChatToolDefinition[] {
  return catalog.map((t) => {
    let desc = t.description;
    if (t.rawName === "find_tools") {
      desc = "Cari tool di katalog hanya jika kemampuan yang dibutuhkan belum tersedia di daftar tools saat ini. Jangan panggil tool ini jika tool yang Anda cari (seperti list_interfaces, list_ip_addresses, dll) sudah ada di daftar.";
    }
    return {
      type: "function" as const,
      function: {
        name: t.fqName.replace(/[^A-Za-z0-9_-]/g, "_"),
        // Deskripsi dipangkas: hemat ~70% token skema tanpa menghilangkan makna.
        // KECUALI tool web (Deep Research): protokol risetnya wajib terlihat
        // utuh oleh model — tanpa ini model tidak mengiterasi pencarian.
        description: desc.slice(0, t.fqName.startsWith("web:") ? 2000 : 300),
        parameters: (t.inputSchema && typeof t.inputSchema === "object"
          ? (t.inputSchema as Record<string, unknown>)
          : { type: "object", properties: {} }),
      },
    };
  });
}
