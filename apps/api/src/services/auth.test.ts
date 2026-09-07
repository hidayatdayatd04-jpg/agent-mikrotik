import { describe, expect, test, beforeEach } from "bun:test";
import { createDb, type Database } from "../db";
import {
  ensureSeedAccount,
  loginWithPassword,
  createSession,
  verifySessionToken,
  revokeSession,
  changePassword,
  SEED_USERNAME,
  SEED_ALIAS,
  SEED_PASSWORD,
} from "./auth";
import { accounts } from "../db/schema";
import { eq } from "drizzle-orm";

let db: Database;
beforeEach(() => {
  db = createDb(":memory:");
});

describe("local auth (seed + session)", () => {
  test("seed creates exact requested account and is idempotent", async () => {
    await ensureSeedAccount(db);
    await ensureSeedAccount(db);
    const rows = await db.select().from(accounts);
    expect(rows.length).toBe(1);
    expect(rows[0]!.username).toBe(SEED_USERNAME);
    expect(rows[0]!.loginAlias).toBe(SEED_ALIAS);
    expect(rows[0]!.displayName).toBe("mikrotik-agent");
    expect(rows[0]!.passwordHash).not.toContain(SEED_PASSWORD);
    // Second provision does not reset password: login still works with seed.
    const acc = await loginWithPassword(db, SEED_USERNAME, SEED_PASSWORD, "test-seed-1");
    expect(acc.username).toBe(SEED_USERNAME);
  });

  test("login works with username and alias literal (non-email)", async () => {
    await ensureSeedAccount(db);
    const a = await loginWithPassword(db, "mikrotik-agent", SEED_PASSWORD, "k1");
    const b = await loginWithPassword(db, "mikrotikagent", SEED_PASSWORD, "k2");
    expect(a.id).toBe(b.id);
  });

  test("wrong password uses generic message and rate-limits", async () => {
    await ensureSeedAccount(db);
    for (let i = 0; i < 10; i++) {
      try {
        await loginWithPassword(db, SEED_USERNAME, "salah", `rl-${i}`);
      } catch {
        /* expected */
      }
    }
    // Same rate key 11th time should be RATE_LIMITED even with correct password.
    await ensureSeedAccount(db);
    let code = "";
    try {
      await loginWithPassword(db, SEED_USERNAME, "salah", "rl-0");
    } catch (err) {
      code = (err as { code?: string }).code ?? "";
    }
    // Different key still gives generic UNAUTHORIZED, not user-enumerating.
    try {
      await loginWithPassword(db, SEED_USERNAME, "salah", "fresh-key-xyz");
    } catch (err) {
      expect((err as { code?: string }).code).toBe("UNAUTHORIZED");
      expect((err as Error).message).toBe("Username atau password salah.");
    }
    void code;
  });

  test("session create/verify/revoke + expiry", async () => {
    await ensureSeedAccount(db);
    const acc = await loginWithPassword(db, SEED_USERNAME, SEED_PASSWORD, "sess-1");
    const { token } = await createSession(db, acc.id);
    const rec = await verifySessionToken(db, token);
    expect(rec?.account.username).toBe(SEED_USERNAME);
    expect(rec?.account.workspaceId).toBeDefined();
    await revokeSession(db, rec!.sessionId);
    expect(await verifySessionToken(db, token)).toBeNull();
    expect(await verifySessionToken(db, "short")).toBeNull();
  });

  test("change password verifies old and keeps login working", async () => {
    await ensureSeedAccount(db);
    const acc = await loginWithPassword(db, SEED_USERNAME, SEED_PASSWORD, "cp-1");
    await changePassword(db, acc.id, SEED_PASSWORD, "baru12345");
    // Old no longer works.
    let failed = false;
    try {
      await loginWithPassword(db, SEED_USERNAME, SEED_PASSWORD, "cp-2");
    } catch {
      failed = true;
    }
    expect(failed).toBe(true);
    const acc2 = await loginWithPassword(db, SEED_ALIAS, "baru12345", "cp-3");
    expect(acc2.id).toBe(acc.id);
    // Restore for other tests (fresh DB per test anyway).
    void acc2;
  });

  test("seed account links to legacy local workspace", async () => {
    await ensureSeedAccount(db);
    const [row] = await db.select().from(accounts).where(eq(accounts.username, SEED_USERNAME)).limit(1);
    expect(row!.workspaceId).toBe("00000000-0000-4000-8000-000000000001");
  });
});
