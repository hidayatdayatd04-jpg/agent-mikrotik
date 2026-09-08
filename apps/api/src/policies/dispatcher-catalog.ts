import type { NormalizedTool } from "./normalize";

/**
 * Builds the catalog the model sees for a mode. Read-Only: verified read tools
 * only (upstream read-only registration ∩ annotation + Rosetta docs + custom
 * read tools). Write: everything classified read/write/destructive — nothing
 * silently dropped to shrink the request.
 */
export function buildModeCatalog(allTools: NormalizedTool[], mode: "read-only" | "write"): NormalizedTool[] {
  if (mode === "write") {
    return allTools.filter((t) => t.risk === "read" || t.risk === "write" || t.risk === "destructive");
  }
  return allTools.filter((t) => t.risk === "read");
}
