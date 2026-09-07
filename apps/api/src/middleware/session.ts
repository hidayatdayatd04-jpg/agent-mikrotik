import type { MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import { verifySessionToken, SESSION_COOKIE } from "../services/auth";
import { AppError } from "../lib/errors";
import type { Database } from "../db";

/**
 * Real session auth. Resolves the `ma_session` cookie into workspace+account.
 * - Public paths (login, health, static) pass through with null workspace.
 * - Test harnesses that pre-set `workspace` keep their value (bypass).
 * - All other /api/* requests without a valid session get workspace=null;
 *   downstream `requireWorkspace` helpers translate that into 401.
 */
export function sessionAuth(db: Database): MiddlewareHandler {
  return async (c, next) => {
    // Test injection bypass: buildTestChatApp sets workspace directly.
    const existing = c.get("workspace" as never) as unknown;
    if (existing && typeof existing === "object" && "userId" in (existing as Record<string, unknown>)) {
      await next();
      return;
    }
    const path = c.req.path;
    const isPublic =
      path === "/api/auth/login" ||
      path === "/health/live" ||
      path === "/health/ready" ||
      path === "/api/ping" ||
      (!path.startsWith("/api/") && !path.startsWith("/health/"));

    const token = getCookie(c, SESSION_COOKIE) ?? "";
    if (!token) {
      c.set("workspace" as never, null as never);
      c.set("account" as never, null as never);
      c.set("sessionId" as never, null as never);
      await next();
      return;
    }
    try {
      const rec = await verifySessionToken(db, token);
      if (!rec) {
        c.set("workspace" as never, null as never);
        c.set("account" as never, null as never);
        c.set("sessionId" as never, null as never);
      } else {
        c.set("workspace" as never, { userId: rec.account.workspaceId } as never);
        c.set("account" as never, rec.account as never);
        c.set("sessionId" as never, rec.sessionId as never);
      }
    } catch {
      c.set("workspace" as never, null as never);
      c.set("account" as never, null as never);
      c.set("sessionId" as never, null as never);
    }
    void isPublic;
    await next();
  };
}

/** Require a valid session; throws 401 when missing. Returns account+workspace. */
export function requireAuth(c: {
  get: (k: "workspace" | "account" | "sessionId") => unknown;
}): { userId: string; account: { id: string; workspaceId: string; username: string; displayName: string; loginAlias: string | null }; sessionId: string } {
  const workspace = c.get("workspace") as { userId: string } | null;
  const account = c.get("account") as { id: string; workspaceId: string; username: string; displayName: string; loginAlias: string | null } | null;
  const sessionId = c.get("sessionId") as string | null;
  if (!workspace || !account || !sessionId) {
    throw new AppError("UNAUTHORIZED", "Session habis atau belum login. Silakan login kembali.", 401);
  }
  return { userId: workspace.userId, account, sessionId };
}
