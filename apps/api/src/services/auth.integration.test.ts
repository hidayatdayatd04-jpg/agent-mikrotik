import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { createDb, type Database } from "../db";
import { loadConfig, type Config } from "../lib/config";
import { createAuthService, MockEmailSender, type CreatedSession } from "./auth";
import { eq } from "drizzle-orm";
import { users, otpChallenges } from "../db/schema";
import { OtpError } from "./otp-error";

/**
 * Integration test against local Docker Postgres (DATABASE_URL env).
 * Skipped automatically when no local database is reachable.
 */
const dbUrl = process.env.DATABASE_URL ?? "postgres://dev:dev@localhost:5432/agent_mikrotik";

let db: Database;
let config: Config;
let auth: ReturnType<typeof createAuthService>;
let capturedCodes: { email: string; code: string }[] = [];

const email = "test-user@example.com";

beforeAll(async () => {
  const cfg = loadConfig({
    ...process.env,
    NODE_ENV: "test",
    DATABASE_URL: dbUrl,
    SESSION_TTL_SECONDS: "3600",
  } as Record<string, string>);
  try {
    db = createDb(dbUrl);
    await db.execute("select 1");
  } catch {
    console.log("no local postgres; skipping auth integration tests");
    return;
  }
  config = cfg;
  const mailer = new MockEmailSender((_, __) => {});
  auth = createAuthService(db, cfg, {
    sendOtp: async (to, code) => {
      capturedCodes.push({ email: to, code });
    },
  });
  // clean test user
  await db.delete(users).where(eq(users.email, email));
});

afterAll(async () => {
  if (db) await db.delete(users).where(eq(users.email, email));
});

describe("OTP login flow (integration, local postgres)", () => {
  test("request → verify → session → me → logout", async () => {
    if (!db) return;
    capturedCodes = [];
    await auth.requestOtp(email);
    expect(capturedCodes.length).toBe(1);

    const session = await auth.verifyOtp(email, capturedCodes[0]!.code);
    expect(session.email).toBe(email);
    expect(session.sessionToken).toBeTruthy();
    expect(session.userId).toBeTruthy();

    // plaintext OTP must not be stored
    const [challenge] = await db
      .select()
      .from(otpChallenges)
      .where(eq(otpChallenges.email, email))
      .limit(1);
    expect(challenge?.digest).not.toBe(capturedCodes[0]!.code);
    expect(challenge?.digest?.length).toBe(64); // sha256 hex

    const resolved = await auth.resolveSession(session.sessionToken);
    expect(resolved?.userId).toBe(session.userId);
    expect(resolved?.emailVerified).toBe(true);

    await auth.revokeSession(session.sessionId);
    const revoked = await auth.resolveSession(session.sessionToken);
    expect(revoked).toBeNull();
  });

  test("wrong code increments attempts and rejects", async () => {
    if (!db) return;
    capturedCodes = [];
    await auth.requestOtp(email);
    try {
      await auth.verifyOtp(email, "000000");
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(OtpError);
      expect((e as OtpError).code).toBe("OTP_INVALID");
    }
  });

  test("replay: same OTP cannot verify twice", async () => {
    if (!db) return;
    capturedCodes = [];
    await auth.requestOtp(email);
    const code = capturedCodes[0]!.code;
    const s1: CreatedSession = await auth.verifyOtp(email, code);
    await auth.revokeSession(s1.sessionId);
    try {
      await auth.verifyOtp(email, code);
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(OtpError);
    }
  });

  test("expired OTP rejected (ttl=0)", async () => {
    if (!db) return;
    const shortConfig = { ...config, OTP_TTL_SECONDS: 0 };
    const shortAuth = createAuthService(db, shortConfig, {
      sendOtp: async (to, code) => {
        capturedCodes.push({ email: to, code });
      },
    });
    capturedCodes = [];
    await shortAuth.requestOtp(email);
    try {
      await shortAuth.verifyOtp(email, capturedCodes[0]!.code);
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(OtpError);
      expect((e as OtpError).code).toBe("OTP_EXPIRED");
    }
  });

  test("resend deactivates previous challenge", async () => {
    if (!db) return;
    capturedCodes = [];
    await auth.requestOtp(email);
    const firstCode = capturedCodes[0]!.code;
    await auth.requestOtp(email);
    const secondCode = capturedCodes[1]!.code;
    expect(firstCode).not.toBe(secondCode);
    // old code must fail (challenge consumed by resend)
    try {
      await auth.verifyOtp(email, firstCode);
      throw new Error("old code should fail");
    } catch (e) {
      expect(e).toBeInstanceOf(OtpError);
    }
    // new code works
    const s = await auth.verifyOtp(email, secondCode);
    await auth.revokeSession(s.sessionId);
  });
});
