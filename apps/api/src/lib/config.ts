import { z } from "zod";
import { resolve } from "node:path";

import { homedir } from "node:os";
const DEFAULT_DATA_DIR = resolve(homedir(), ".mikrotik-agent");

const int = (def: number, min: number, max: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === "" ? def : Number(v)))
    .refine((v) => Number.isInteger(v) && v >= min && v <= max, {
      message: `must be an integer between ${min} and ${max}`,
    })
    .transform((v) => Math.floor(v as number));

export const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  API_PORT: int(3001, 1, 65535),

  DATA_DIR: z.string().default(DEFAULT_DATA_DIR),
  // Default server-side provider (fallback when the user has not configured
  // their own provider in the DB). The user's per-user setting takes priority.
  AI_PROVIDER_KIND: z.enum(["gemini", "openrouter", "custom", ""]).default(""),
  AI_PROVIDER_BASE_URL: z.string().optional(),
  AI_PROVIDER_MODEL: z.string().optional(),
  AI_PROVIDER_API_KEY: z.string().optional(),

  UPLOAD_MAX_BYTES: int(10485760, 1, 100 * 1024 * 1024),
  UPLOAD_MAX_FILES_PER_MESSAGE: int(4, 1, 16),

  MCP_BUN_EXECUTABLE: z.string().default("bun"),
  ROSETTA_DATA_DIR: z.string().optional(),
  ROUTER_ALLOWED_CIDRS: z.string().default(""),
  SSH_CONNECT_TIMEOUT_MS: int(10000, 500, 120000),
  MCP_IDLE_TIMEOUT_SECONDS: int(900, 30, 86400),
  MAX_MCP_PROCESSES_PER_USER: int(2, 1, 16),
  MAX_MCP_PROCESSES_TOTAL: int(20, 1, 256),
  AGENT_MAX_STEPS: int(24, 1, 64),
  AGENT_MAX_TOOL_CALLS: int(30, 1, 128),
  AGENT_RUN_TIMEOUT_MS: int(180000, 5000, 600000),
  MAX_ACTIONS_PER_TRANSACTION: int(20, 1, 200),
  // Centralized AI rate limiter (aturan #1): default 15 RPM + 150.000 TPM per
  // model untuk seluruh provider (Gemini/OpenRouter/custom). RPD tidak
  // dibatasi lokal. Nilai dapat dioverride via env bila provider resmi lebih rendah.
  RATE_LIMIT_RPM: int(15, 1, 1000),
  RATE_LIMIT_TPM: int(1000000, 1000, 10000000),
  RATE_LIMIT_MAX_QUEUE: int(50, 1, 1000),
  RATE_LIMIT_MAX_WAIT_MS: int(300000, 1000, 3600000),
  RATE_LIMIT_MAX_RETRIES: int(3, 0, 10),
  // JSON opsional: {"providers":{"gemini":{"rpm":2}},"models":{"gemini:gemini-2.0-flash":{"tpm":60000}},"shared":{"key:abc":{"rpm":4}}}
  RATE_LIMIT_OVERRIDES_JSON: z.string().optional(),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export type Env = z.infer<typeof EnvSchema>;

export interface Config extends Env {
  isProduction: boolean;
  useMockProvider: boolean;
  routerAllowedCidrs: string[];
  rosettaDbPath: string;
}

export function loadConfig(from: Record<string, string | undefined> = process.env): Config {
  const parsed = EnvSchema.safeParse(from);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  const env = parsed.data;
  const isProduction = env.NODE_ENV === "production";
  return {
    ...env,
    isProduction,
    useMockProvider: !env.AI_PROVIDER_API_KEY,
    routerAllowedCidrs: env.ROUTER_ALLOWED_CIDRS.split(",").map((s) => s.trim()).filter(Boolean),
    rosettaDbPath: resolve(env.ROSETTA_DATA_DIR ?? resolve(env.DATA_DIR, "corpus"), "ros-help.db"),
  };
}

/** Parse RATE_LIMIT_OVERRIDES_JSON menjadi override per-provider/model/shared. */
export function parseRateLimitOverrides(raw?: string): {
  providerOverrides: Record<string, { rpm?: number; tpm?: number }>;
  modelOverrides: Record<string, { rpm?: number; tpm?: number }>;
  sharedOverrides: Record<string, { rpm?: number; tpm?: number }>;
} {
  const empty = { providerOverrides: {}, modelOverrides: {}, sharedOverrides: {} };
  if (!raw || !raw.trim()) return empty;
  try {
    const parsed = JSON.parse(raw) as {
      providers?: Record<string, { rpm?: number; tpm?: number }>;
      models?: Record<string, { rpm?: number; tpm?: number }>;
      shared?: Record<string, { rpm?: number; tpm?: number }>;
    };
    const clean = (v: { rpm?: number; tpm?: number } | undefined) => {
      const out: { rpm?: number; tpm?: number } = {};
      if (typeof v?.rpm === "number" && Number.isFinite(v.rpm) && v.rpm > 0) out.rpm = Math.floor(v.rpm);
      if (typeof v?.tpm === "number" && Number.isFinite(v.tpm) && v.tpm > 0) out.tpm = Math.floor(v.tpm);
      return out;
    };
    const providerOverrides: Record<string, { rpm?: number; tpm?: number }> = {};
    const modelOverrides: Record<string, { rpm?: number; tpm?: number }> = {};
    const sharedOverrides: Record<string, { rpm?: number; tpm?: number }> = {};
    for (const [k, v] of Object.entries(parsed.providers ?? {})) {
      const c = clean(v);
      if (c.rpm !== undefined || c.tpm !== undefined) providerOverrides[k] = c;
    }
    for (const [k, v] of Object.entries(parsed.models ?? {})) {
      const c = clean(v);
      if (c.rpm !== undefined || c.tpm !== undefined) modelOverrides[k] = c;
    }
    for (const [k, v] of Object.entries(parsed.shared ?? {})) {
      const c = clean(v);
      if (c.rpm !== undefined || c.tpm !== undefined) sharedOverrides[k] = c;
    }
    return { providerOverrides, modelOverrides, sharedOverrides };
  } catch {
    return empty;
  }
}
