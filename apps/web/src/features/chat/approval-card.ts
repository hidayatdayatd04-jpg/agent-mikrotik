/**
 * Interactive Approval Card for AI Agent Write Operations.
 * When the AI proposes changes or requires approval before executing
 * risky/mutating commands, it emits an approval fence block in chat:
 *
 * ```approval
 * {
 *   "summary": "Nonaktifkan Interface ether5",
 *   "riskLevel": "high",
 *   "impactDescription": "Menonaktifkan ether5 akan memutuskan koneksi perangkat yang tersambung ke port tersebut.",
 *   "affectedObjects": ["/interface ether5"],
 *   "operations": [
 *     { "command": "/interface disable ether5", "description": "Matikan interface ether5", "risk": "destructive" }
 *   ]
 * }
 * ```
 */

export interface ApprovalOperation {
  command: string;
  description: string;
  risk?: "read" | "write" | "destructive";
}

export interface ApprovalSpec {
  id?: string;
  summary: string;
  riskLevel: "low" | "medium" | "high" | "critical";
  impactDescription?: string;
  affectedObjects?: string[];
  operations: ApprovalOperation[];
  diffBefore?: string;
  diffAfter?: string;
}

const FENCE_RE = /```approval\s*\n([\s\S]*?)\n?```/g;

function isApprovalSpec(val: unknown): val is ApprovalSpec {
  if (!val || typeof val !== "object") return false;
  const spec = val as Record<string, unknown>;
  if (typeof spec.summary !== "string" || !spec.summary) return false;
  if (!Array.isArray(spec.operations) || spec.operations.length === 0) return false;
  const validRisk = ["low", "medium", "high", "critical"];
  const riskLevel = typeof spec.riskLevel === "string" && validRisk.includes(spec.riskLevel)
    ? spec.riskLevel
    : "medium";
  spec.riskLevel = riskLevel;
  if (typeof spec.diffBefore === "string") spec.diffBefore = spec.diffBefore;
  if (typeof spec.diffAfter === "string") spec.diffAfter = spec.diffAfter;

  return spec.operations.every((op) => {
    if (!op || typeof op !== "object") return false;
    const o = op as Record<string, unknown>;
    return typeof o.command === "string" && o.command.length > 0;
  });
}

/** Parse all approval blocks in a message. Returns null when none are valid. */
export function extractApprovalBlocks(text: string): ApprovalSpec[] | null {
  FENCE_RE.lastIndex = 0;
  const out: ApprovalSpec[] = [];
  let m: RegExpExecArray | null;
  while ((m = FENCE_RE.exec(text)) !== null) {
    try {
      const parsed: unknown = JSON.parse(m[1] ?? "");
      if (isApprovalSpec(parsed)) out.push(parsed);
    } catch {
      /* ignore malformed json */
    }
  }
  return out.length > 0 ? out : null;
}

/** Remove approval fences, keeping surrounding prose. */
export function stripApprovalBlocks(text: string): string {
  FENCE_RE.lastIndex = 0;
  return text
    .replace(FENCE_RE, (_full, inner: string) => {
      try {
        const parsed: unknown = JSON.parse(inner ?? "");
        if (isApprovalSpec(parsed)) return "";
      } catch {
        /* keep inner text if unparseable */
      }
      return `\n${inner ?? ""}\n`;
    })
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
