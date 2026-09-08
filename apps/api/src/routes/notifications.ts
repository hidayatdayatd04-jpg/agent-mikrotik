import { Hono } from "hono";
import type { Env as HonoEnv } from "../types";
import { AppError } from "../lib/errors";
import type { NotificationService } from "../services/notification";

export function createNotificationRoutes(deps: { notifications: NotificationService }) {
  const app = new Hono<HonoEnv>();

  // GET /api/notifications
  app.get("/", async (c) => {
    const workspace = c.get("workspace");
    if (!workspace) throw new AppError("UNAUTHORIZED", "Login diperlukan.", 401);
    const unreadOnly = c.req.query("unreadOnly") === "true";
    const limit = parseInt(c.req.query("limit") ?? "50", 10);
    const offset = parseInt(c.req.query("offset") ?? "0", 10);
    const items = await deps.notifications.list(workspace.userId, { unreadOnly, limit, offset });
    return c.json({ notifications: items });
  });

  // GET /api/notifications/unread-count
  app.get("/unread-count", async (c) => {
    const workspace = c.get("workspace");
    if (!workspace) throw new AppError("UNAUTHORIZED", "Login diperlukan.", 401);
    const count = await deps.notifications.unreadCount(workspace.userId);
    return c.json({ count });
  });

  // GET /api/notifications/settings
  app.get("/settings", async (c) => {
    const workspace = c.get("workspace");
    if (!workspace) throw new AppError("UNAUTHORIZED", "Login diperlukan.", 401);
    const settings = await deps.notifications.getSettings(workspace.userId);
    return c.json(settings);
  });

  // PATCH /api/notifications/settings
  app.patch("/settings", async (c) => {
    const workspace = c.get("workspace");
    if (!workspace) throw new AppError("UNAUTHORIZED", "Login diperlukan.", 401);
    const body = await c.req.json();
    await deps.notifications.updateSettings(workspace.userId, body);
    const settings = await deps.notifications.getSettings(workspace.userId);
    return c.json(settings);
  });

  // POST /api/notifications/mark-all-read
  app.post("/mark-all-read", async (c) => {
    const workspace = c.get("workspace");
    if (!workspace) throw new AppError("UNAUTHORIZED", "Login diperlukan.", 401);
    await deps.notifications.markAllRead(workspace.userId);
    return c.json({ ok: true });
  });

  // PATCH /api/notifications/:id/read
  app.patch("/:id/read", async (c) => {
    const workspace = c.get("workspace");
    if (!workspace) throw new AppError("UNAUTHORIZED", "Login diperlukan.", 401);
    await deps.notifications.markRead(workspace.userId, c.req.param("id"));
    return c.json({ ok: true });
  });

  // DELETE /api/notifications/:id
  app.delete("/:id", async (c) => {
    const workspace = c.get("workspace");
    if (!workspace) throw new AppError("UNAUTHORIZED", "Login diperlukan.", 401);
    await deps.notifications.remove(workspace.userId, c.req.param("id"));
    return c.json({ ok: true });
  });

  return app;
}
