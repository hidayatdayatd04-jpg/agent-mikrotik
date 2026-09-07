/** Context budget + estimation helpers. Conservative char/4 estimator, labeled estimasi. */
export interface ContextBudget {
  capacity: number | null;
  basis: "input" | "total" | null;
  systemChars: number;
  schemaChars: number;
  summaryChars: number;
  historyChars: number;
  attachmentChars: number;
  newMessageChars: number;
  reserveOutput: number;
  margin: number;
}

export function estimateTokens(chars: number): number {
  // Conservative: ~3.5 chars per token for mixed ID/EN + RouterOS output.
  return Math.ceil(chars / 3.5);
}

export function budgetUsage(b: ContextBudget): { estimatedInputTokens: number; percent: number | null } {
  const totalChars =
    b.systemChars + b.schemaChars + b.summaryChars + b.historyChars + b.attachmentChars + b.newMessageChars;
  const estimated = estimateTokens(totalChars) + b.reserveOutput + b.margin;
  if (!b.capacity) return { estimatedInputTokens: estimated, percent: null };
  return { estimatedInputTokens: estimated, percent: (estimated / b.capacity) * 100 };
}

export function shouldCompact(percent: number | null, threshold = 80): boolean {
  if (percent === null) return false;
  return percent >= threshold;
}

export function clipText(text: string, maxChars: number): { text: string; truncated: boolean } {
  if (text.length <= maxChars) return { text, truncated: false };
  return { text: text.slice(0, maxChars), truncated: true };
}
