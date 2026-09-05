import { randomBytes } from "node:crypto";
import { and, eq, isNull, gt, desc, lt } from "drizzle-orm";
import type { Database } from "../db";
import { otpChallenges, sessions, users, authIdentities } from "../db/schema";
import { sha256Hex, constantTimeEquals } from "../lib/crypto";
import type { Config } from "../lib/config";
import { generateOtp, otpDigest } from "./auth-core";
import { OtpError } from "./otp-error";

export interface EmailSender {
  sendOtp(to: string, code: string, ttlSeconds: number): Promise<void>;
}

export class MockEmailSender implements EmailSender {
  constructor(private log: (msg: string, data?: unknown) => void) {}
  async sendOtp(to: string, code: string, ttlSeconds: number): Promise<void> {
    this.log(`[MOCK EMAIL] OTP untuk ${to}: ${code} (berlaku ${ttlSeconds}s)`, { mock: true });
  }
}

export interface SessionContext {
  userId: string;
  sessionId: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  emailVerified: boolean;
}

export interface CreatedSession extends SessionContext {
  sessionToken: string;
}

export function createAuthService(db: Database, config: Config, mailer: EmailSender) {
  const otpSecret = config.OTP_HMAC_SECRET ?? "dev-only-otp-secret";

  async function requestOtp(rawEmail: string): Promise<{ sent: true }> {
    const email = rawEmail.trim().toLowerCase();
    const code = generateOtp();
    const expiresAt = new Date(Date.now() + config.OTP_TTL_SECONDS * 1000);

    // deactivate previous pending challenges for this email (resend replaces)
    await db
      .update(otpChallenges)
      .set({ consumedAt: new Date() })
      .where(
        and(
          eq(otpChallenges.email, email),
          isNull(otpChallenges.consumedAt),
          gt(otpChallenges.expiresAt, new Date()),
        ),
      );

    const [challenge] = await db
      .insert(otpChallenges)
      .values({
        email,
        purpose: "login",
        digest: "pending",
        expiresAt,
        deliveryStatus: "pending",
      })
      .returning();
    if (!challenge) throw new Error("gagal membuat challenge OTP");

    const digest = otpDigest(otpSecret, challenge.id, email, "login", code);
    await db
      .update(otpChallenges)
      .set({ digest })
      .where(eq(otpChallenges.id, challenge.id));

    try {
      await mailer.sendOtp(email, code, config.OTP_TTL_SECONDS);
      await db
        .update(otpChallenges)
        .set({ deliveryStatus: "sent" })
        .where(eq(otpChallenges.id, challenge.id));
    } catch (err) {
      await db
        .update(otpChallenges)
        .set({ deliveryStatus: "failed" })
        .where(eq(otpChallenges.id, challenge.id));
      throw err;
    }
    return { sent: true };
  }

  async function verifyOtp(rawEmail: string, code: string): Promise<CreatedSession> {
    const email = rawEmail.trim().toLowerCase();
    const [challenge] = await db
      .select()
      .from(otpChallenges)
      .where(
        and(
          eq(otpChallenges.email, email),
          eq(otpChallenges.purpose, "login"),
          isNull(otpChallenges.consumedAt),
        ),
      )
      .orderBy(desc(otpChallenges.createdAt))
      .limit(1);
    if (!challenge) throw new OtpError("OTP_INVALID", "Kode OTP tidak ditemukan atau sudah digunakan.");
    if (challenge.expiresAt.getTime() < Date.now()) {
      throw new OtpError("OTP_EXPIRED", "Kode OTP sudah kedaluwarsa. Minta kode baru.");
    }
    if (challenge.attempts >= config.OTP_MAX_ATTEMPTS) {
      throw new OtpError("OTP_INVALID", "Percobaan melebihi batas. Minta kode baru.");
    }

    const provided = otpDigest(otpSecret, challenge.id, email, "login", code);
    if (!constantTimeEquals(provided, challenge.digest)) {
      await db
        .update(otpChallenges)
        .set({ attempts: challenge.attempts + 1 })
        .where(eq(otpChallenges.id, challenge.id));
      throw new OtpError("OTP_INVALID", "Kode OTP salah.");
    }

    // consume atomically: only if still unconsumed
    const consumed = await db
      .update(otpChallenges)
      .set({ consumedAt: new Date() })
      .where(and(eq(otpChallenges.id, challenge.id), isNull(otpChallenges.consumedAt)))
      .returning();
    if (consumed.length === 0) {
      throw new OtpError("OTP_CONSUMED", "Kode OTP sudah digunakan.");
    }

    const user = await findOrCreateUser(email, { verified: true });
    if (!user) throw new OtpError("OTP_INVALID", "Gagal menyiapkan akun.");
    return createSession(user);
  }

  async function findOrCreateUser(
    email: string,
    opts: { verified: boolean; name?: string; avatarUrl?: string | null },
  ) {
    const [existing] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (existing) {
      if (opts.verified && !existing.emailVerifiedAt) {
        const [updated] = await db
          .update(users)
          .set({ emailVerifiedAt: new Date(), updatedAt: new Date() })
          .where(eq(users.id, existing.id))
          .returning();
        return updated ?? existing;
      }
      return existing;
    }
    const [created] = await db
      .insert(users)
      .values({
        email,
        name: opts.name ?? email.split("@")[0]!,
        avatarUrl: opts.avatarUrl ?? null,
        emailVerifiedAt: opts.verified ? new Date() : null,
      })
      .returning();
    if (!created) throw new Error("gagal membuat user");
    return created;
  }

  async function linkGoogleIdentity(userId: string, subject: string) {
    await db
      .insert(authIdentities)
      .values({ userId, provider: "google", subject })
      .onConflictDoNothing();
  }

  async function findUserByGoogleSubject(subject: string) {
    const [row] = await db
      .select({ user: users })
      .from(authIdentities)
      .innerJoin(users, eq(users.id, authIdentities.userId))
      .where(and(eq(authIdentities.provider, "google"), eq(authIdentities.subject, subject)))
      .limit(1);
    return row?.user ?? null;
  }

  async function createSession(user: {
    id: string;
    email: string;
    name: string;
    avatarUrl: string | null;
    emailVerifiedAt: Date | null;
  }): Promise<CreatedSession> {
    const token = randomBytes(32).toString("base64url");
    const tokenHash = sha256Hex(token);
    const expiresAt = new Date(Date.now() + config.SESSION_TTL_SECONDS * 1000);
    const [session] = await db
      .insert(sessions)
      .values({ userId: user.id, tokenHash, expiresAt })
      .returning();
    if (!session) throw new Error("gagal membuat session");

    return {
      userId: user.id,
      sessionId: session.id,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatarUrl,
      emailVerified: !!user.emailVerifiedAt,
      sessionToken: token,
    };
  }

  async function resolveSession(token: string): Promise<SessionContext | null> {
    if (!token) return null;
    const tokenHash = sha256Hex(token);
    const [row] = await db
      .select({ session: sessions, user: users })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(and(eq(sessions.tokenHash, tokenHash), isNull(sessions.revokedAt), gt(sessions.expiresAt, new Date())))
      .limit(1);
    if (!row) return null;
    return {
      userId: row.user.id,
      sessionId: row.session.id,
      email: row.user.email,
      name: row.user.name,
      avatarUrl: row.user.avatarUrl,
      emailVerified: !!row.user.emailVerifiedAt,
    };
  }

  async function revokeSession(sessionId: string) {
    await db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, sessionId));
  }

  async function cleanupExpired() {
    await db.delete(otpChallenges).where(lt(otpChallenges.expiresAt, new Date(Date.now() - 86400_000)));
    await db.delete(sessions).where(lt(sessions.expiresAt, new Date(Date.now() - 86400_000)));
  }

  return {
    requestOtp,
    verifyOtp,
    createSession,
    resolveSession,
    revokeSession,
    findOrCreateUser,
    linkGoogleIdentity,
    findUserByGoogleSubject,
    cleanupExpired,
  };
}

export type AuthService = ReturnType<typeof createAuthService>;
