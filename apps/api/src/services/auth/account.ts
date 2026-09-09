import { eq, or } from "drizzle-orm";
import type { Database } from "../../db";
import { accounts, preferences } from "../../db/schema";
import { LOCAL_WORKSPACE_ID } from "../../lib/workspace";
import { AppError } from "../../lib/errors";
import type { Logger } from "../../lib/logger";
import { hashPassword, verifyPassword } from "./password";

export const SEED_USERNAME = "mikrotik-agent";
export const SEED_ALIAS = "mikrotikagent";
export const SEED_PASSWORD = "mikrotik123";
export const SEED_DISPLAY = "mikrotik-agent";

/** Idempotent seed: creates the requested local account once, never resets password. */
export async function ensureSeedAccount(db: Database, logger?: Pick<Logger, "info" | "warn">): Promise<void> {
  const existing = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(or(eq(accounts.username, SEED_USERNAME), eq(accounts.loginAlias, SEED_ALIAS)))
    .limit(1);
  if (existing.length > 0) return;
  // Ensure the legacy local workspace exists (migrations already insert it, but be defensive).
  try {
    await db.run(`INSERT OR IGNORE INTO workspaces (id, name) VALUES ('${LOCAL_WORKSPACE_ID}', 'Lokal')`);
  } catch {
    /* ignore */
  }
  const passwordHash = await hashPassword(SEED_PASSWORD);
  const id = crypto.randomUUID();
  const now = new Date();
  try {
    await db.insert(accounts).values({
      id,
      workspaceId: LOCAL_WORKSPACE_ID,
      username: SEED_USERNAME,
      loginAlias: SEED_ALIAS,
      displayName: SEED_DISPLAY,
      passwordHash,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(preferences).values({ accountId: id }).onConflictDoNothing();
    logger?.info("seed account created", { username: SEED_USERNAME });
  } catch (err) {
    // Race between two startups: unique constraint means another process won.
    const msg = err instanceof Error ? err.message : String(err);
    if (!/UNIQUE|unique/i.test(msg)) throw err;
  }
}

export interface AuthAccount {
  id: string;
  workspaceId: string;
  username: string;
  loginAlias: string | null;
  displayName: string;
}

export async function findAccountByIdentifier(db: Database, identifier: string): Promise<(AuthAccount & { passwordHash: string }) | null> {
  const id = identifier.trim();
  if (!id) return null;
  const rows = await db.select().from(accounts).where(or(eq(accounts.username, id), eq(accounts.loginAlias, id))).limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    username: row.username,
    loginAlias: row.loginAlias,
    displayName: row.displayName,
    passwordHash: row.passwordHash,
  };
}

// In-memory login rate limit per key (IP + identifier bucket).
const loginAttempts = new Map<string, number[]>();
const LOGIN_MAX = 10;
const LOGIN_WINDOW_MS = 10 * 60 * 1000;

export function checkLoginRateLimit(key: string): void {
  const now = Date.now();
  const cutoff = now - LOGIN_WINDOW_MS;
  const times = (loginAttempts.get(key) ?? []).filter((t) => t > cutoff);
  if (times.length >= LOGIN_MAX) {
    throw new AppError("RATE_LIMITED", "Terlalu banyak percobaan login. Tunggu beberapa menit.", 429);
  }
  times.push(now);
  loginAttempts.set(key, times);
}

export function clearLoginRateLimit(key: string): void {
  loginAttempts.delete(key);
}

export async function loginWithPassword(
  db: Database,
  identifier: string,
  password: string,
  rateKey: string,
): Promise<AuthAccount> {
  checkLoginRateLimit(rateKey);
  // Ensure seed exists so first login works on fresh installs.
  await ensureSeedAccount(db);
  const acc = await findAccountByIdentifier(db, identifier);
  // Generic failure message to avoid user enumeration; still rate-limited.
  const invalid = new AppError("UNAUTHORIZED", "Username atau password salah.", 401);
  if (!acc) throw invalid;
  const ok = await verifyPassword(password, acc.passwordHash);
  if (!ok) throw invalid;
  clearLoginRateLimit(rateKey);
  return { id: acc.id, workspaceId: acc.workspaceId, username: acc.username, loginAlias: acc.loginAlias, displayName: acc.displayName };
}

export async function changePassword(
  db: Database,
  accountId: string,
  oldPassword: string,
  newPassword: string,
): Promise<void> {
  if (newPassword.length < 8) throw new AppError("VALIDATION_FAILED", "Password baru minimal 8 karakter.", 422);
  if (newPassword.length > 256) throw new AppError("VALIDATION_FAILED", "Password baru maksimal 256 karakter.", 422);
  const rows = await db.select().from(accounts).where(eq(accounts.id, accountId)).limit(1);
  const acc = rows[0];
  if (!acc) throw new AppError("UNAUTHORIZED", "Session tidak valid.", 401);
  const ok = await verifyPassword(oldPassword, acc.passwordHash);
  if (!ok) throw new AppError("UNAUTHORIZED", "Password lama salah.", 401);
  const hash = await hashPassword(newPassword);
  await db.update(accounts).set({ passwordHash: hash, updatedAt: new Date() }).where(eq(accounts.id, accountId));
}
