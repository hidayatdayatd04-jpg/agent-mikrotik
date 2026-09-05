export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const SENSITIVE_KEYS =
  /(password|passwd|secret|token|api[-_]?key|private[-_]?key|authorization|credential|psk|cookie)/i;

const REDACTED = "[REDACTED]";

function redactValue(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[DEPTH_LIMIT]";
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => redactValue(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SENSITIVE_KEYS.test(k) ? REDACTED : redactValue(v, depth + 1);
  }
  return out;
}

export interface Logger {
  debug(msg: string, data?: unknown): void;
  info(msg: string, data?: unknown): void;
  warn(msg: string, data?: unknown): void;
  error(msg: string, data?: unknown): void;
}

export function createLogger(level: LogLevel = "info"): Logger {
  const threshold = LEVELS[level];
  const emit = (lvl: LogLevel, msg: string, data?: unknown) => {
    if (LEVELS[lvl] < threshold) return;
    const payload =
      data === undefined
        ? ""
        : ` ${JSON.stringify(redactValue(data) satisfies unknown)}`;
    const line = `[${new Date().toISOString()}] ${lvl.toUpperCase()} ${msg}${payload}`;
    if (lvl === "error") console.error(line);
    else if (lvl === "warn") console.warn(line);
    else console.log(line);
  };
  return {
    debug: (m, d) => emit("debug", m, d),
    info: (m, d) => emit("info", m, d),
    warn: (m, d) => emit("warn", m, d),
    error: (m, d) => emit("error", m, d),
  };
}

export { redactValue };
