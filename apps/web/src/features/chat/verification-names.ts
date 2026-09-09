/**
 * Helpers for extracting live RouterOS verification details and generating
 * natural human narratives directly beneath the approval card in the same chat output.
 */

export function extractRouterOsNames(output: string): string[] {
  if (!output) return [];
  const lines = output.split(/\r?\n/);
  const names: string[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    // Skip banner or header lines
    if (/^(flags|#|\*|columns|total)/i.test(line)) continue;
    if (
      line.includes("NAME") &&
      (line.includes("INTERFACE") ||
        line.includes("MTU") ||
        line.includes("VLAN-ID") ||
        line.includes("ADDRESS") ||
        line.includes("DISABLED"))
    ) {
      continue;
    }

    // Pattern 1: name="xxx" or name=xxx
    const nameAttrMatch = line.match(/\bname="?([^"\s;]+)"?/i);
    if (nameAttrMatch && nameAttrMatch[1]) {
      const n = nameAttrMatch[1].trim();
      if (n && !names.includes(n)) names.push(n);
      continue;
    }

    // Pattern 2: Tabular line starting with row number: e.g. "0 R vlan30-guest 1500 ..."
    const tabMatch = line.match(/^\d+\s*(?:[A-Za-z*]+\s+)?([a-zA-Z0-9_.-]+)/);
    if (tabMatch && tabMatch[1]) {
      const candidate = tabMatch[1].trim();
      if (
        !/^\d+$/.test(candidate) &&
        !["R", "X", "D", "I", "S", "A", "B"].includes(candidate.toUpperCase())
      ) {
        if (!names.includes(candidate)) names.push(candidate);
      }
    }
  }

  return names;
}

export function formatItemNames(items: string[]): string {
  if (items.length === 0) return "";
  const codeItems = items.map((i) => `\`${i}\``);
  if (codeItems.length === 1) return codeItems[0]!;
  if (codeItems.length === 2) return `${codeItems[0]} dan ${codeItems[1]}`;
  return `${codeItems.slice(0, -1).join(", ")}, dan ${codeItems[codeItems.length - 1]}`;
}
