/**
 * Connection-target argument names an LLM must never set — the SSH target and
 * credentials always come from the server-side connector, never from tool args.
 * Deliberately NARROW: legitimate RouterOS rule parameters such as `address`,
 * `ip`, `port`, `device`, `target`, or file names must stay usable (e.g.
 * `add_ip_address` requires `address`; filter rules accept `port`). The
 * per-connection MCP child is already bound to one router, so rule data args
 * cannot redirect execution elsewhere.
 */
export const FORBIDDEN_ARG_NAMES = new Set([
  "host", "hostname",
  "username", "user", "password", "credential", "credentials",
]);

export function findForbiddenArg(val: unknown, depth = 0): string | null {
  if (depth > 8 || !val || typeof val !== "object") return null;
  if (Array.isArray(val)) {
    for (const item of val) {
      const found = findForbiddenArg(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  for (const [key, child] of Object.entries(val as Record<string, unknown>)) {
    if (FORBIDDEN_ARG_NAMES.has(key.toLowerCase())) return key;
    const found = findForbiddenArg(child, depth + 1);
    if (found) return found;
  }
  return null;
}
