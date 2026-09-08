const SENSITIVE_KEY =
  /(?:[\w-]*(?:password|passwd|passphrase|secret|token|key|psk|credential)s?)/i.source;

const SENSITIVE_PAIR_RE = new RegExp(
  `("?${SENSITIVE_KEY}"?\\s*[:=]\\s*)((?:"(?:\\\\.|[^"\\\\])*")|(?:'(?:\\\\.|[^'\\\\])*')|[^\\s,;}\\]]+)`,
  "gi",
);

const REDACTED = "[REDACTED]";

export function redactText(text: string): string {
  return text.replace(SENSITIVE_PAIR_RE, (_match, prefix: string, value: string) => {
    const isQuoted = value.startsWith('"') || value.startsWith("'");
    return `${prefix}${isQuoted ? `"${REDACTED}"` : REDACTED}`;
  });
}

const SENSITIVE_KEY_RE =
  /(password|passwd|passphrase|secret|token|api[-_]?key|private[-_]?key|authorization|credential|psk|cookie)/i;

export function redactObject<T>(value: T): T {
  const visit = (v: unknown, depth: number): unknown => {
    if (depth > 8) return "[DEPTH]";
    if (v === null || typeof v !== "object") return v;
    if (Array.isArray(v)) return v.map((item) => visit(item, depth + 1));
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEY_RE.test(k) ? REDACTED : visit(val, depth + 1);
    }
    return out;
  };
  return visit(value, 0) as T;
}

export function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.password) u.password = REDACTED;
    if (u.searchParams.has("signature") || u.searchParams.has("X-Amz-Signature")) {
      for (const p of ["signature", "X-Amz-Signature", "X-Amz-Credential", "X-Amz-Security-Token"]) {
        if (u.searchParams.has(p)) u.searchParams.set(p, REDACTED);
      }
    }
    return u.toString();
  } catch {
    return url;
  }
}
