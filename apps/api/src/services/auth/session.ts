import { createHash, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Database } from "../../db";
import { accounts, sessions } from "../../db/schema";
import type { AuthAccount } from "./account";

export const SESSION_COOKIE = "ma_session";
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function newSessionToken(): string {
  return randomBytes(32).toString("hex");
}

export async function createSession(db: Database, accountId: string): Promise<{ token: string; expiresAt: Date; sessionId: string }> {
  const token = newSessionToken();
  const tokenHash = hashToken(token);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  const sessionId = crypto.randomUUID();
  // Cleanup expired sessions opportunistically (bounded).
  try {
    await db.run(`DELETE FROM sessions WHERE expires_at < ${now.getTime()} LIMIT 100`);
  } catch {
    /* table may not exist in very old test DBs — ignore */
  }
  await db.insert(sessions).values({
    id: sessionId,
    tokenHash,
    accountId,
    createdAt: now,
    expiresAt,
    lastSeenAt: now,
  });
  return { token, expiresAt, sessionId };
}

export interface SessionRecord {
  sessionId: string;
  account: AuthAccount;
  expiresAt: Date;
}

export async function verifySessionToken(db: Database, token: string): Promise<SessionRecord | null> {
  if (!token || token.length < 32) return null;
  const tokenHash = hashToken(token);
  const rows = await db.select().from(sessions).where(eq(sessions.tokenHash, tokenHash)).limit(1);
  const sess = rows[0];
  if (!sess || sess.revokedAt) return null;
  if (sess.expiresAt.getTime() <= Date.now()) return null;
  const accRows = await db.select().from(accounts).where(eq(accounts.id, sess.accountId)).limit(1);
  const acc = accRows[0];
  if (!acc) return null;
  // Touch last_seen occasionally (best-effort, no await chain failure).
  void db
    .update(sessions)
    .set({ lastSeenAt: new Date() })
    .where(eq(sessions.id, sess.id))
    .catch(() => {});
  return {
    sessionId: sess.id,
    account: {
      id: acc.id,
      workspaceId: acc.workspaceId,
      username: acc.username,
      loginAlias: acc.loginAlias,
      displayName: acc.displayName,
    },
    expiresAt: sess.expiresAt,
  };
}

export async function revokeSession(db: Database, sessionId: string): Promise<void> {
  await db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, sessionId));
}

export async function revokeOtherSessions(db: Database, accountId: string, keepSessionId: string): Promise<void> {
  const all = await db.select({ id: sessions.id }).from(sessions).where(eq(sessions.accountId, accountId));
  const now = new Date();
  for (const row of all) {
    if (row.id === keepSessionId) continue;
    await db.update(sessions).set({ revokedAt: now }).where(eq(sessions.id, row.id));
  }
}

export async function revokeAllForAccount(db: Database, accountId: string): Promise<void> {
  await db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.accountId, accountId));
}
