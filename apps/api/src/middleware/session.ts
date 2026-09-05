import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { Env } from "../types";
import { AppError } from "../lib/errors";
import type { SessionContext } from "../services/auth";

export const SESSION_COOKIE = "session";

export function sessionFromCookie<T extends Env>(c: { req: unknown; get: (k: "session") => SessionContext | undefined }): SessionContext {
  const session = c.get("session");
  if (!session) throw new AppError("AUTH_REQUIRED", "Silakan masuk terlebih dahulu.", 401);
  return session;
}

/**
 * Same-origin protection for state-changing browser requests:
 * Origin header must match a trusted origin when present.
 */
export function requireTrustedOrigin(originHeader: string | undefined, trustedOrigins: string[]) {
  if (originHeader === undefined) return; // non-browser clients (no Origin) handled by auth
  if (!trustedOrigins.includes(originHeader)) {
    throw new AppError("FORBIDDEN", "Origin tidak diizinkan.", 403);
  }
}

export function setSessionCookie(
  cookies: {
    set: (name: string, value: string, opts: Record<string, unknown>) => void;
  },
  token: string,
  opts: { secure: boolean; maxAge: number },
) {
  cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "Lax",
    secure: opts.secure,
    path: "/",
    maxAge: opts.maxAge,
  });
}

export function clearSessionCookie(
  cookies: {
    delete: (name: string, opts?: Record<string, unknown>) => void;
  },
) {
  cookies.delete(SESSION_COOKIE, { path: "/" });
}

export { getCookie };
