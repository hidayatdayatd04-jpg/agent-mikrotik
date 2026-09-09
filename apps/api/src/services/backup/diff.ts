export interface DiffResult {
  added: number;
  removed: number;
  changed: number;
  lines: DiffLine[];
}

export interface DiffLine {
  type: "added" | "removed" | "unchanged";
  lineNumber: { left: number | null; right: number | null };
  content: string;
}

export function computeDiff(left: string, right: string): DiffResult {
  const leftLines = left.split("\n");
  const rightLines = right.split("\n");
  const result: DiffLine[] = [];
  let added = 0, removed = 0;

  // Simple LCS-based diff
  const lcs = buildLCS(leftLines, rightLines);
  let li = 0, ri = 0, ci = 0;

  while (li < leftLines.length || ri < rightLines.length) {
    if (ci < lcs.length && li < leftLines.length && ri < rightLines.length && leftLines[li] === lcs[ci] && rightLines[ri] === lcs[ci]) {
      result.push({ type: "unchanged", lineNumber: { left: li + 1, right: ri + 1 }, content: leftLines[li]! });
      li++; ri++; ci++;
    } else if (ci < lcs.length && li < leftLines.length && leftLines[li] !== lcs[ci]) {
      result.push({ type: "removed", lineNumber: { left: li + 1, right: null }, content: leftLines[li]! });
      removed++;
      li++;
    } else if (ci < lcs.length && ri < rightLines.length && rightLines[ri] !== lcs[ci]) {
      result.push({ type: "added", lineNumber: { left: null, right: ri + 1 }, content: rightLines[ri]! });
      added++;
      ri++;
    } else if (li < leftLines.length) {
      result.push({ type: "removed", lineNumber: { left: li + 1, right: null }, content: leftLines[li]! });
      removed++;
      li++;
    } else if (ri < rightLines.length) {
      result.push({ type: "added", lineNumber: { left: null, right: ri + 1 }, content: rightLines[ri]! });
      added++;
      ri++;
    }
  }

  return { added, removed, changed: Math.min(added, removed), lines: result };
}

function buildLCS(a: string[], b: string[]): string[] {
  // Optimized for reasonable-length configs; caps at 5000 lines per side
  const maxLen = 5000;
  const aa = a.slice(0, maxLen);
  const bb = b.slice(0, maxLen);
  const m = aa.length, n = bb.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i]![j] = aa[i - 1] === bb[j - 1] ? dp[i - 1]![j - 1]! + 1 : Math.max(dp[i - 1]![j]!, dp[i]![j - 1]!);
    }
  }
  const result: string[] = [];
  let i = m, j = n;
  while (i > 0 && j > 0) {
    if (aa[i - 1] === bb[j - 1]) { result.unshift(aa[i - 1]!); i--; j--; }
    else if (dp[i - 1]![j]! > dp[i]![j - 1]!) i--;
    else j--;
  }
  return result;
}
