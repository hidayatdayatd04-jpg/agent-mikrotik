/**
 * Parser for RouterOS CLI print output (value-list and column formats).
 *
 * Handles: empty fields, flags column, multi-line values (indented continuation),
 * quoted values with embedded spaces, "no such item" style errors, and the
 * trailing prompt noise. Returns typed rows with redaction applied by the caller.
 */

export interface ParsedRow {
  /** 0-based index of the row as printed (NOT a stable identifier) */
  index: number;
  /** stable RouterOS .id when present (e.g. "*1") */
  id: string | null;
  flags: string;
  fields: Record<string, string>;
}

export interface ParsedOutput {
  ok: boolean;
  rows: ParsedRow[];
  /** raw error line when the command failed (e.g. "no such item") */
  error: string | null;
  raw: string;
}

/** Parse `print` output in value-list form: field="value" pairs per entry. */
export function parseValueList(output: string): ParsedOutput {
  const lines = output.split(/\r?\n/);
  const rows: ParsedRow[] = [];
  let error: string | null = null;

  let current: ParsedRow | null = null;
  let sawData = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    sawData = true;

    if (/^(failure|error|bad|no such|invalid|unknown|syntax error)/i.test(trimmed)) {
      error = trimmed;
      continue;
    }
    if (/^flags:/i.test(trimmed)) continue; // flags legend line
    if (/[>#$] $/.test(line)) continue; // prompt
    if (/^\s+\S+=/.test(line) && current) {
      // continuation of previous entry
      collectFields(trimmed, current);
      continue;
    }
    // new entry header: "N K fields..." or "N fields..."
    const header = /^\s*(\d+)\s+([A-Z-]*)\s*(.*)$/.exec(trimmed);
    if (header) {
      current = { index: Number(header[1]), id: null, flags: header[2] ?? "", fields: {} };
      rows.push(current);
      const rest = header[3] ?? "";
      if (rest) collectFields(rest, current);
      continue;
    }
    // unnumbered output (e.g. single-value print)
    if (!current) {
      current = { index: 0, id: null, flags: "", fields: {} };
      rows.push(current);
    }
    collectFields(trimmed, current);
  }

  if (!sawData && !error) {
    // empty output can mean zero rows — that is a valid ok state for print
    return { ok: true, rows: [], error: null, raw: output };
  }
  return { ok: error === null, rows, error, raw: output };
}

const FIELD_RE = /([A-Za-z0-9_.-]+)=("((?:[^"\\]|\\.)*)"|\S+)/g;

function collectFields(text: string, row: ParsedRow): void {
  for (const m of text.matchAll(FIELD_RE)) {
    const name = m[1];
    let value = m[2];
    if (name === undefined || value === undefined) continue;
    if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
      value = value.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
    }
    if (name === ".id" || name === "id") {
      if (row.id === null) row.id = value;
    }
    row.fields[name] = value;
  }
}

/** Parse flag letters and non-field prefix (column print), e.g. "0 X  ether1". */
export function parseFlags(cell: string): { flags: string; rest: string } {
  const m = /^([A-Z-]+)\s+(.*)$/.exec(cell);
  if (!m || m[1] === undefined || m[2] === undefined) return { flags: "", rest: cell };
  return { flags: m[1], rest: m[2] };
}

/** Detect a RouterOS failure text anywhere in the output. */
export function detectError(output: string): string | null {
  const m = output.match(/\b(failure: [^\r\n]+|no such item[^\r\n]*|syntax error[^\r\n]*|invalid value[^\r\n]*|bad command[^\r\n]*)/i);
  return m?.[1] ?? null;
}
