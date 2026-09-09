/** Regex patterns to redact sensitive fields from RouterOS exports. */
const REDACT_PATTERNS = [
  /password=("[^"]*"|[^\s]+)/gi,
  /secret=("[^"]*"|[^\s]+)/gi,
  /private-key=("[^"]*"|[^\s]+)/gi,
  /passphrase=("[^"]*"|[^\s]+)/gi,
  /community=("[^"]*"|[^\s]+)/gi,
  /auth-key=("[^"]*"|[^\s]+)/gi,
  /priv-key=("[^"]*"|[^\s]+)/gi,
  /wpa-pre-shared-key=("[^"]*"|[^\s]+)/gi,
  /wpa2-pre-shared-key=("[^"]*"|[^\s]+)/gi,
  /certificate=("[^"]*"|[^\s]+)/gi,
  /shared-secret=("[^"]*"|[^\s]+)/gi,
];

export function redactExport(content: string): string {
  let result = content;
  for (const pattern of REDACT_PATTERNS) {
    result = result.replace(pattern, (match) => {
      const eqIdx = match.indexOf("=");
      return `${match.substring(0, eqIdx + 1)}[REDACTED]`;
    });
  }
  return result;
}
