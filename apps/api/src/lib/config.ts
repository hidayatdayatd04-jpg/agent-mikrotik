import { z } from "zod";
import { resolve } from "node:path";

// apps/api/src/lib → repo root is three levels up
const DEFAULT_ROSETTA_DIR = resolve(import.meta.dir, "../../../../tooling/corpus");

const int = (def: number, min: number, max: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === "" ? def : Number(v)))
    .refine((v) => Number.isFinite(v) && v >= min && v <= max, {
      message: `must be an integer between ${min} and ${max}`,
    })
    .transform((v) => Math.floor(v as number));

export const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_URL: z.string().url().default("http://localhost:3000"),
  API_PORT: int(3001, 1, 65535),
  TRUSTED_ORIGINS: z.string().default("http://localhost:3000"),

  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  DATABASE_URL_DIRECT: z.string().optional(),

  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_REDIRECT_URI: z
    .string()
    .url()
    .default("http://localhost:3000/api/auth/callback/google"),

  BREVO_API_KEY: z.preprocess((v) => (v === "" ? undefined : v), z.string().optional()),
  BREVO_SENDER_NAME: z.string().default("MikroTik AI Agent"),
  BREVO_SENDER_EMAIL: z.preprocess((v) => (v === "" ? undefined : v), z.string().email().optional()),
  BREVO_SMTP_KEY: z.preprocess((v) => (v === "" ? undefined : v), z.string().optional()),
  BREVO_SMTP_HOST: z.string().default("smtp-relay.brevo.com"),
  BREVO_SMTP_PORT: int(587, 1, 65535),
  BREVO_SMTP_LOGIN: z.preprocess((v) => (v === "" ? undefined : v), z.string().optional()),

  // Default server-side provider (fallback when the user has not configured
  // their own provider in the DB). The user's per-user setting takes priority.
  AI_PROVIDER_KIND: z.enum(["gemini", "openrouter", "custom", ""]).default(""),
  AI_PROVIDER_BASE_URL: z.string().optional(),
  AI_PROVIDER_MODEL: z.string().optional(),
  AI_PROVIDER_API_KEY: z.string().optional(),

  ROUTER_CREDENTIAL_KEY: z
    .string()
    .optional()
    .refine(
      (v) => v === undefined || /^[A-Za-z0-9+/]{43}={0,2}$/.test(v) || v.length >= 32,
      { message: "ROUTER_CREDENTIAL_KEY must be a base64 32-byte key" },
    ),
  ROUTER_CREDENTIAL_KEY_VERSION: int(1, 1, 255),
  /** Key lama (base64 32-byte) untuk decrypt record versi sebelumnya saat rotasi. */
  ROUTER_CREDENTIAL_KEY_PREVIOUS: z
    .string()
    .optional()
    .refine(
      (v) => v === undefined || /^[A-Za-z0-9+/]{43}={0,2}$/.test(v) || v.length >= 32,
      { message: "ROUTER_CREDENTIAL_KEY_PREVIOUS must be a base64 32-byte key" },
    ),
  ROUTER_CREDENTIAL_KEY_PREVIOUS_VERSION: int(2, 2, 255).optional(),
  OTP_HMAC_SECRET: z.string().optional(),
  OTP_TTL_SECONDS: int(300, 30, 3600),
  OTP_MAX_ATTEMPTS: int(5, 1, 20),
  OTP_RESEND_SECONDS: int(60, 10, 3600),
  SESSION_TTL_SECONDS: int(604800, 300, 30 * 86400),

  B2_KEY_ID: z.string().optional(),
  B2_APPLICATION_KEY: z.string().optional(),
  B2_BUCKET: z.string().optional(),
  B2_REGION: z.string().optional(),
  B2_ENDPOINT: z.string().optional(),
  UPLOAD_MAX_BYTES: int(10485760, 1, 100 * 1024 * 1024),
  UPLOAD_MAX_FILES_PER_MESSAGE: int(4, 1, 16),

  MCP_BUN_EXECUTABLE: z.string().default("bun"),
  ROSETTA_DATA_DIR: z.string().default(DEFAULT_ROSETTA_DIR),
  ROUTER_ALLOWED_CIDRS: z.string().default(""),
  SSH_CONNECT_TIMEOUT_MS: int(10000, 500, 120000),
  MCP_IDLE_TIMEOUT_SECONDS: int(900, 30, 86400),
  MAX_MCP_PROCESSES_PER_USER: int(2, 1, 16),
  MAX_MCP_PROCESSES_TOTAL: int(20, 1, 256),
  AGENT_MAX_STEPS: int(12, 1, 64),
  AGENT_MAX_TOOL_CALLS: int(30, 1, 128),
  AGENT_RUN_TIMEOUT_MS: int(120000, 5000, 600000),
  MAX_ACTIONS_PER_TRANSACTION: int(20, 1, 200),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export type Env = z.infer<typeof EnvSchema>;

export interface Config extends Env {
  isProduction: boolean;
  useMockEmail: boolean;
  useMockProvider: boolean;
  useMockOAuth: boolean;
  trustedOrigins: string[];
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
    // Real OTP email requires the VERIFIED SMTP path (host/login/key + verified
    // sender). The REST API key alone is NOT sufficient: Brevo blocks unknown
    // IPs on the API (docs/decisions.md D-010) and sending needs a sender address.
    useMockEmail: !env.BREVO_SMTP_KEY || !env.BREVO_SMTP_LOGIN || !env.BREVO_SENDER_EMAIL,
    useMockProvider: !env.AI_PROVIDER_API_KEY,
    useMockOAuth: !env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET,
    trustedOrigins: env.TRUSTED_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean),
    routerAllowedCidrs: env.ROUTER_ALLOWED_CIDRS.split(",").map((s) => s.trim()).filter(Boolean),
    rosettaDbPath: `${env.ROSETTA_DATA_DIR}/ros-help.db`,
  };
}
