export const MONITORING_COMMAND = [
  ":put \"===RESOURCE===\"",
  "/system resource print",
  ":put \"===IDENTITY===\"",
  "/system identity print",
  ":put \"===HEALTH===\"",
  "/system health print",
  ":put \"===INTERFACES===\"",
  "/interface print detail",
  ":put \"===DHCP===\"",
  "/ip dhcp-server lease print count-only",
  ":put \"===ARP===\"",
  "/ip arp print count-only",
  ":put \"===PING===\"",
  "/ping 8.8.8.8 count=1",
].join("; ");

export function parseSection(output: string, tag: string): string {
  const startTag = `===${tag}===`;
  const startIdx = output.indexOf(startTag);
  if (startIdx === -1) return "";
  const content = output.substring(startIdx + startTag.length);
  const nextTag = content.indexOf("===");
  return nextTag === -1 ? content.trim() : content.substring(0, nextTag).trim();
}

export function parseNumber(value: string | undefined): number | null {
  if (!value) return null;
  // Handle MiB/KiB suffixes
  const cleaned = value.replace(/[^0-9.]/g, "");
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

export function parseUptime(value: string | undefined): string | null {
  if (!value) return null;
  return value.trim();
}

export function parseCpuLoad(value: string | undefined): number | null {
  if (!value) return null;
  const num = parseInt(value.replace("%", ""), 10);
  return isNaN(num) ? null : Math.min(100, Math.max(0, num));
}

export function parseMemoryBytes(value: string | undefined): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  // RouterOS reports memory in bytes or MiB
  if (/MiB$/i.test(trimmed)) {
    const num = parseFloat(trimmed.replace(/MiB$/i, ""));
    return isNaN(num) ? null : Math.round(num * 1024 * 1024);
  }
  if (/KiB$/i.test(trimmed)) {
    const num = parseFloat(trimmed.replace(/KiB$/i, ""));
    return isNaN(num) ? null : Math.round(num * 1024);
  }
  const num = parseFloat(trimmed);
  return isNaN(num) ? null : Math.round(num);
}

export function parseColonKeyValue(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const colonIdx = trimmed.indexOf(":");
    if (colonIdx > 0) {
      const k = trimmed.substring(0, colonIdx).trim().toLowerCase();
      const v = trimmed.substring(colonIdx + 1).trim();
      result[k] = v;
    }
  }
  return result;
}
