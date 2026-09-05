import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import type { Env } from "../types";
import { AppError } from "../lib/errors";
import { getCookie } from "hono/cookie";
import { SESSION_COOKIE } from "../middleware/session";
import type { AuthService, EmailSender, SessionContext } from "../services/auth";
import { OtpError } from "../services/otp-error";
import { createRateLimiter } from "../services/auth-core";
import type { Logger } from "../lib/logger";

const EmailSchema = z.string().email().max(320);

export function createAuthRoutes(deps: {
  auth: AuthService;
  email: EmailSender;
  logger: Logger;
  otpSecret: string;
  db: Parameters<typeof createRateLimiter>[0];
  config: {
    isProduction: boolean;
    useMockOAuth: boolean;
    useMockEmail: boolean;
    trustedOrigins: string[];
    APP_URL: string;
    OTP_TTL_SECONDS: number;
    OTP_RESEND_SECONDS: number;
    OTP_MAX_ATTEMPTS: number;
    SESSION_TTL_SECONDS: number;
    GOOGLE_CLIENT_ID?: string;
    GOOGLE_CLIENT_SECRET?: string;
    GOOGLE_REDIRECT_URI: string;
  };
}) {
  const routes = new Hono<Env>();
  const limit = createRateLimiter(deps.db, deps.otpSecret);

  async function otpRateLimit(kind: string, key: string, cap: number, windowSeconds: number) {
    const res = await limit(`${kind}:${key}`, cap, windowSeconds);
    if (!res.allowed) {
      throw new AppError("RATE_LIMITED", `Terlalu banyak permintaan. Coba lagi dalam ${res.retryAfterSeconds} detik.`, 429);
    }
  }

  routes.post("/otp/request", zValidator("json", z.object({ email: EmailSchema })), async (c) => {
    const cfg = c.get("config");
    requireOrigin(c);
    const { email } = c.req.valid("json");

    await otpRateLimit("otp-req-ip", clientIp(c), 10, 60 * 15);
    await otpRateLimit("otp-req-email", email.toLowerCase(), 3, 60 * 15);

    await deps.auth.requestOtp(email);
    return c.json({ sent: true, mockDelivery: cfg.useMockEmail });
  });

  routes.post("/otp/verify", zValidator("json", z.object({ email: EmailSchema, code: z.string().regex(/^\d{6}$/) })), async (c) => {
    const cfg = c.get("config");
    requireOrigin(c);
    const { email, code } = c.req.valid("json");

    await otpRateLimit("otp-verify-ip", clientIp(c), 20, 60 * 15);
    await otpRateLimit("otp-verify-email", email.toLowerCase(), cfg.OTP_MAX_ATTEMPTS * 2, 60 * 15);

    try {
      const session = await deps.auth.verifyOtp(email, code);
      setSessionCookie(c, session.sessionToken, {
        secure: cfg.isProduction,
        maxAge: cfg.SESSION_TTL_SECONDS,
      });
      return c.json({ user: publicUser(session) });
    } catch (err) {
      if (err instanceof OtpError) throw new AppError(err.code, err.message, 400);
      throw err;
    }
  });

  routes.get("/me", (c) => {
    const session = requireSession(c);
    return c.json({ user: publicUser(session) });
  });

  routes.post("/logout", async (c) => {
    requireOrigin(c);
    const session = requireSession(c);
    await deps.auth.revokeSession(session.sessionId);
    c.header("Set-Cookie", `${SESSION_COOKIE}=; Path=/; Max-Age=0`);
    return c.json({ ok: true });
  });

  // --- Google OAuth (OIDC authorization-code flow) ---
  routes.get("/google", async (c) => {
    const cfg = c.get("config");
    if (cfg.useMockOAuth) {
      // Dev-only bypass: clearly labeled, refuses to run in production.
      if (cfg.isProduction) throw new AppError("INTERNAL_ERROR", "Mock OAuth tidak tersedia di production.", 500);
      const user = await deps.auth.findOrCreateUser("dev-google@localhost", {
        verified: true,
        name: "Dev Google User",
      });
      if (!user) throw new AppError("INTERNAL_ERROR", "Gagal membuat user dev.", 500);
      const session = await deps.auth.createSession(user);
      setSessionCookie(c, session.sessionToken, {
        secure: cfg.isProduction,
        maxAge: cfg.SESSION_TTL_SECONDS,
      });
      return c.redirect(cfg.APP_URL);
    }
    const state = crypto.randomUUID();
    const nonce = crypto.randomUUID();
    const params = new URLSearchParams({
      client_id: cfg.GOOGLE_CLIENT_ID!,
      redirect_uri: cfg.GOOGLE_REDIRECT_URI,
      response_type: "code",
      scope: "openid email profile",
      state,
      nonce,
    });
    c.header(
      "Set-Cookie",
      serializeCookie("g_state", `${state}.${nonce}`, {
        httpOnly: true,
        sameSite: "Lax",
        secure: cfg.isProduction,
        path: "/",
        maxAge: 600,
      }),
    );
    return c.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
  });

  routes.get("/callback/google", async (c) => {
    const cfg = c.get("config");
    if (cfg.useMockOAuth) return c.redirect(cfg.APP_URL);
    const url = new URL(c.req.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const cookieState = getCookie(c, "g_state");
    if (!code || !state || !cookieState) throw new AppError("AUTH_REQUIRED", "Callback tidak valid.", 400);
    const [expectedState] = cookieState.split(".");
    if (!expectedState || !constantTimeEq(state, expectedState)) {
      throw new AppError("AUTH_REQUIRED", "State OAuth tidak cocok.", 400);
    }

    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: cfg.GOOGLE_CLIENT_ID!,
        client_secret: cfg.GOOGLE_CLIENT_SECRET!,
        code,
        grant_type: "authorization_code",
        redirect_uri: cfg.GOOGLE_REDIRECT_URI,
      }),
    });
    if (!tokenRes.ok) throw new AppError("AUTH_REQUIRED", "Pertukaran token Google gagal.", 400);
    const tokens = (await tokenRes.json()) as { id_token: string };

    const claims = decodeJwtPayload(tokens.id_token);
    const now = Math.floor(Date.now() / 1000);
    if (claims.iss !== "https://accounts.google.com" && claims.iss !== "accounts.google.com") {
      throw new AppError("AUTH_REQUIRED", "Issuer token tidak valid.", 400);
    }
    if (claims.aud !== cfg.GOOGLE_CLIENT_ID) throw new AppError("AUTH_REQUIRED", "Audience token tidak cocok.", 400);
    if (typeof claims.exp === "number" && claims.exp < now) throw new AppError("AUTH_REQUIRED", "Token kedaluwarsa.", 400);
    if (claims.email_verified !== true) throw new AppError("AUTH_REQUIRED", "Email Google belum terverifikasi.", 400);

    const email = String(claims.email).toLowerCase();
    let user = await deps.auth.findUserByGoogleSubject(String(claims.sub));
    if (!user) {
      const created = await deps.auth.findOrCreateUser(email, {
        verified: true,
        name: String(claims.name ?? email.split("@")[0] ?? email),
        avatarUrl: typeof claims.picture === "string" ? claims.picture : null,
      });
      if (!created) throw new AppError("AUTH_REQUIRED", "Gagal menyiapkan akun Google.", 500);
      user = created;
      await deps.auth.linkGoogleIdentity(user.id, String(claims.sub));
    }
    const session = await deps.auth.createSession(user);
    setSessionCookie(c, session.sessionToken, {
      secure: cfg.isProduction,
      maxAge: cfg.SESSION_TTL_SECONDS,
    });
    c.header("Set-Cookie", "g_state=; Path=/; Max-Age=0");
    return c.redirect(cfg.APP_URL);
  });

  function requireSession(c: { get: (k: "session") => unknown }) {
    const s = c.get("session");
    if (!s) throw new AppError("AUTH_REQUIRED", "Silakan masuk terlebih dahulu.", 401);
    return s as SessionContext;
  }

  function requireOrigin(c: {
    req: { header: (n: string) => string | undefined };
    get: (k: "config") => { trustedOrigins: string[] };
  }) {
    const origin = c.req.header("Origin");
    const cfg = c.get("config");
    if (origin !== undefined && !cfg.trustedOrigins.includes(origin)) {
      throw new AppError("FORBIDDEN", "Origin tidak diizinkan.", 403);
    }
  }

  function clientIp(c: { req: { header: (n: string) => string | undefined } }) {
    return c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  }

  return routes;
}

function setSessionCookie(
  c: { header: (n: string, v: string) => void },
  token: string,
  opts: { secure: boolean; maxAge: number },
) {
  c.header(
    "Set-Cookie",
    serializeCookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "Lax",
      secure: opts.secure,
      path: "/",
      maxAge: opts.maxAge,
    }),
  );
}

function constantTimeEq(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  // timing-safe compare
  const { timingSafeEqual } = require("node:crypto") as typeof import("node:crypto");
  return timingSafeEqual(bufA, bufB);
}

function publicUser(s: {
  userId: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  emailVerified: boolean;
}) {
  return {
    id: s.userId,
    email: s.email,
    name: s.name,
    avatarUrl: s.avatarUrl,
    emailVerified: s.emailVerified,
  };
}

function serializeCookie(name: string, value: string, opts: Record<string, unknown>): string {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${opts.path ?? "/"}`];
  if (opts.httpOnly) parts.push("HttpOnly");
  if (opts.sameSite) parts.push(`SameSite=${opts.sameSite}`);
  if (opts.secure) parts.push("Secure");
  if (typeof opts.maxAge === "number") parts.push(`Max-Age=${opts.maxAge}`);
  return parts.join("; ");
}

interface JwtPayload {
  iss?: string;
  aud?: string;
  sub?: string;
  exp?: number;
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
  [k: string]: unknown;
}

/**
 * Decode payload of the id_token returned by Google's token endpoint over TLS.
 * Signature authenticity comes from the server-to-server code exchange; issuer,
 * audience, and expiry are validated explicitly above.
 */
function decodeJwtPayload(jwt: string): JwtPayload {
  const part = jwt.split(".")[1];
  if (!part) throw new AppError("AUTH_REQUIRED", "Token Google malformed.", 400);
  const json = Buffer.from(part, "base64url").toString("utf8");
  return JSON.parse(json) as JwtPayload;
}
