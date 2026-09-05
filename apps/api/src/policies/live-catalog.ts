import type { NormalizedTool } from "./normalize";
import { buildModeCatalog } from "./dispatcher";
import { normalizeUpstreamTools } from "./normalize";
import type { McpChild } from "../mcp/supervisor";

/**
 * Live catalog source backed by the supervised child processes:
 * - mikrotik-mcp full catalog (mode respawns when mode changes — see supervisor)
 * - Rosetta documentation tools (always read)
 * - custom tools from packages/mikrotik-tools (always read)
 * The catalog is rebuilt from the live child registration whenever the child
 * respawns (mode change), never from a stale snapshot.
 */
export interface LiveCatalogDeps {
  getFullChild(): Promise<McpChild>;
  getReadOnlyChild(): Promise<McpChild>;
  rosettaToolNames: () => Promise<{ name: string; description?: string; inputSchema?: unknown }[]>;
  customTools: NormalizedTool[];
  rosettaNamespace?: string;
  mikrotikNamespace?: string;
}

export function createLiveCatalogSource(deps: LiveCatalogDeps) {
  const rosettaNs = deps.rosettaNamespace ?? "docs";
  const mtNs = deps.mikrotikNamespace ?? "mt";

  async function loadAll(): Promise<NormalizedTool[]> {
    const [full, roSetRaw, roRaw] = await Promise.all([
      deps.getFullChild().then(paginateTools),
      deps.getReadOnlyChild().then(paginateTools),
      deps.rosettaToolNames(),
    ]);
    const upstream = normalizeUpstreamTools(full, roSetRaw.map((t) => ({ name: t.name })), "upstream-mikrotik", mtNs);
    // Rosetta: documentation-only, always read
    const rosetta: NormalizedTool[] = roRaw.map((t) => ({
      fqName: `${rosettaNs}:${t.name}`,
      rawName: t.name,
      origin: "upstream-rosetta",
      risk: "read",
      classificationProvenance: "upstream-annotation+read-only-registration",
      capabilities: [],
      inputSchema: t.inputSchema,
      description: t.description ?? "",
      isGateway: false,
    }));
    return [...upstream, ...rosetta, ...deps.customTools];
  }

  // cache per mode with invalidation when the supervisor respawns a child
  let cache: { mode: "read-only" | "write"; tools: NormalizedTool[] } | null = null;

  return {
    async getCatalog(mode: "read-only" | "write"): Promise<NormalizedTool[]> {
      if (cache && cache.mode === mode) return buildModeCatalog(cache.tools, mode);
      const all = await loadAll();
      cache = { mode, tools: all };
      return buildModeCatalog(all, mode);
    },
    invalidate() {
      cache = null;
    },
  };
}

type RawTool = { name: string; description?: string; inputSchema?: unknown; annotations?: Record<string, unknown> };
async function paginateTools(child: McpChild): Promise<RawTool[]> {
  const tools: RawTool[] = [];
  let cursor: string | undefined;
  do {
    const page = await child.client.listTools({ cursor });
    tools.push(...(page.tools ?? []));
    cursor = page.nextCursor;
  } while (cursor);
  return tools;
}
