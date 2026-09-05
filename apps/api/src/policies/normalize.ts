import type { ToolManifest } from "@mikrotik-tools/index";

/**
 * Normalized tool entry shared by the policy layer.
 * Classification provenance is explicit: a tool is read-only only when an
 * explicit, reviewed source says so — never guessed from the name.
 */
export interface NormalizedTool {
  /** fully-qualified tool id visible to the model, e.g. "mt:add_address_list_entry" */
  fqName: string;
  /** raw name at the origin server */
  rawName: string;
  origin: "upstream-mikrotik" | "upstream-rosetta" | "custom";
  risk: "read" | "write" | "destructive" | "unknown";
  classificationProvenance:
    | "upstream-annotation+read-only-registration" // listed in read-only child's tools/list
    | "upstream-annotation"
    | "custom-manifest"
    | "none";
  capabilities: string[];
  inputSchema: unknown;
  description: string;
  /** true when the tool can invoke other tools / run raw commands */
  isGateway: boolean;
}

/** Tools that can bypass per-tool classification by invoking others. */
const GATEWAY_PATTERNS = /^(invoke_tool|run_routeros_command|run_command|execute_command)$/i;

/**
 * Known catalog structure is NOT hardcoded here: names come from the live
 * tools/list at runtime. Only the gateway pattern set is explicit.
 */
export function normalizeUpstreamTools(
  fullTools: { name: string; description?: string; inputSchema?: unknown; annotations?: Record<string, unknown> }[],
  readOnlyTools: { name: string }[],
  origin: "upstream-mikrotik" | "upstream-rosetta",
  namespace: string,
): NormalizedTool[] {
  const readOnlyNames = new Set(readOnlyTools.map((t) => t.name));
  return fullTools.map((t) => {
    // The read-only registration IS the strongest read-only signal: the child
    // itself refuses write operations internally (verified in the M0 spike).
    // Tools not present there are NOT read-only regardless of annotation.
    const inReadOnly = readOnlyNames.has(t.name);
    const ann = t.annotations ?? {};
    const destructive = ann.destructiveHint === true;
    const readOnlyHint = ann.readOnlyHint === true;
    // an annotation is "present" only when the field exists (even false) —
    // empty annotations {} means upstream never classified this tool
    const hasAnyAnnotation = ann.readOnlyHint !== undefined || ann.destructiveHint !== undefined;
    let risk: NormalizedTool["risk"];
    let provenance: NormalizedTool["classificationProvenance"];
    if (inReadOnly && readOnlyHint) {
      risk = "read";
      provenance = "upstream-annotation+read-only-registration";
    } else if (inReadOnly && !readOnlyHint) {
      // present in read-only registration but unannotated → treat as unknown until reviewed
      risk = "unknown";
      provenance = "none";
    } else if (destructive) {
      risk = "destructive";
      provenance = "upstream-annotation";
    } else if (readOnlyHint) {
      // annotation claims read-only but the read-only registration excludes it → contradiction
      risk = "unknown";
      provenance = "none";
    } else if (!hasAnyAnnotation) {
      // never classified by upstream → unknown until reviewed
      risk = "unknown";
      provenance = "none";
    } else {
      risk = "write";
      provenance = "upstream-annotation";
    }
    return {
      fqName: `${namespace}:${t.name}`,
      rawName: t.name,
      origin,
      risk,
      classificationProvenance: provenance,
      capabilities: [],
      inputSchema: t.inputSchema,
      description: t.description ?? "",
      isGateway: GATEWAY_PATTERNS.test(t.name),
    };
  });
}

export function normalizeCustomTools(manifests: ToolManifest[], namespace = "custom"): NormalizedTool[] {
  return manifests.map((m) => ({
    fqName: `${namespace}:${m.id}`,
    rawName: m.id,
    origin: "custom" as const,
    risk: m.risk === "read-only" ? "read" : m.risk === "write" ? "write" : "destructive",
    classificationProvenance: "custom-manifest",
    capabilities: m.capabilities,
    inputSchema: m.inputSchema,
    description: m.description,
    isGateway: false,
  }));
}
