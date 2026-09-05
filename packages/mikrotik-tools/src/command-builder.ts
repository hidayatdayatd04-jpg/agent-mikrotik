/**
 * RouterOS CLI command builder.
 *
 * Builds commands as structured token arrays — never via string interpolation
 * of user input. Every value is quoted with RouterOS escaping rules so a
 * hostile value can never break out of its argument.
 */

const RE_NEEDS_QUOTE = /[\s"'\\;,(){}\[\]$#=/]/;

/** Escape a value for safe inclusion in a quoted RouterOS argument. */
export function escapeValue(value: string): string {
  // backslash first, then quote
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/** Quote a value when it contains RouterOS-special characters. */
export function quoteValue(value: string): string {
  if (!RE_NEEDS_QUOTE.test(value)) return value;
  return `"${escapeValue(value)}"`;
}

export type CommandSegment = { op: string; value?: string } | string;

export interface CommandBuilder {
  /** e.g. "ip firewall filter" */
  menu(...path: string[]): CommandBuilder;
  /** operation word: print, add, set, remove, enable, disable, move, ... */
  op(operation: string): CommandBuilder;
  /** named argument: name="ether1" */
  arg(name: string, value: string | number | boolean): CommandBuilder;
  /** flag argument: detail, count-only, terse */
  flag(...names: string[]): CommandBuilder;
  /** positional values after the operation (e.g. numbers for move) */
  value(...values: (string | number)[]): CommandBuilder;
  /** identifier-based selector: .id=*1 (preferred over row positions) */
  whereId(id: string): CommandBuilder;
  /** property filter: where name="x" — property values are quoted too */
  where(prop: string, value: string): CommandBuilder;
  /** raw token append — internal/validated use only */
  raw(token: string): CommandBuilder;
  /** render the full command string */
  build(): string;
}

const IDENT_RE = /^[a-z0-9][a-z0-9-]*$/i;
const OP_RE = /^[a-z][a-z0-9-]*$/i;

function encodeArgValue(v: string | number | boolean): string {
  if (typeof v === "boolean") return v ? "yes" : "no";
  return quoteValue(String(v));
}

export function command(): CommandBuilder {
  const segments: CommandSegment[] = [];
  const b: CommandBuilder = {
    menu(...path) {
      for (const p of path) {
        if (!IDENT_RE.test(p)) throw new Error(`invalid menu segment: ${JSON.stringify(p)}`);
        segments.push(p);
      }
      return b;
    },
    op(operation) {
      if (!OP_RE.test(operation)) throw new Error(`invalid operation: ${JSON.stringify(operation)}`);
      segments.push({ op: operation });
      return b;
    },
    arg(name, value) {
      if (!IDENT_RE.test(name)) throw new Error(`invalid argument name: ${JSON.stringify(name)}`);
      segments.push(`${name}=${encodeArgValue(value)}`);
      return b;
    },
    flag(...names) {
      for (const n of names) {
        if (!IDENT_RE.test(n)) throw new Error(`invalid flag: ${JSON.stringify(n)}`);
        segments.push(n);
      }
      return b;
    },
    value(...values) {
      for (const v of values) segments.push(quoteValue(String(v)));
      return b;
    },
    whereId(id) {
      // .id always quoted: stable RouterOS identifier, uniform form
      segments.push(`.id="${escapeValue(id)}"`);
      return b;
    },
    where(prop, value) {
      if (!IDENT_RE.test(prop)) throw new Error(`invalid where property: ${JSON.stringify(prop)}`);
      segments.push(`where`);
      // where-values are always quoted — uniform and safest
      segments.push(`${prop}="${escapeValue(value)}"`);
      return b;
    },
    raw(token) {
      segments.push(token);
      return b;
    },
    build() {
      const parts: string[] = [];
      for (const s of segments) {
        if (typeof s === "string") parts.push(s);
        else parts.push(s.op);
      }
      return parts.join(" ");
    },
  };
  return b;
}
