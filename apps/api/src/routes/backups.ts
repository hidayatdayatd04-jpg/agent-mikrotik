import { Hono } from "hono";
import type { Env as HonoEnv } from "../types";
import { AppError } from "../lib/errors";
import type { BackupService } from "../services/backup";

export function createBackupRoutes(deps: { backups: BackupService }) {
  const app = new Hono<HonoEnv>();

  // POST /api/backups/:connectionId — create snapshot
  app.post("/:connectionId", async (c) => {
    const workspace = c.get("workspace");
    if (!workspace) throw new AppError("UNAUTHORIZED", "Login diperlukan.", 401);
    const connectionId = c.req.param("connectionId");
    const body = await c.req.json().catch(() => ({})) as { name?: string };
    const backup = await deps.backups.createSnapshot(workspace.userId, connectionId, { name: body.name });
    return c.json({ backup });
  });

  // GET /api/backups — list all
  app.get("/", async (c) => {
    const workspace = c.get("workspace");
    if (!workspace) throw new AppError("UNAUTHORIZED", "Login diperlukan.", 401);
    const connectionId = c.req.query("connectionId") ?? undefined;
    const limit = parseInt(c.req.query("limit") ?? "50", 10);
    const offset = parseInt(c.req.query("offset") ?? "0", 10);
    const backups = await deps.backups.listBackups(workspace.userId, { connectionId, limit, offset });
    return c.json({ backups });
  });

  // POST /api/backups/compare — diff two backups
  app.post("/compare", async (c) => {
    const workspace = c.get("workspace");
    if (!workspace) throw new AppError("UNAUTHORIZED", "Login diperlukan.", 401);
    const body = await c.req.json() as { backupId1: string; backupId2: string };
    if (!body.backupId1 || !body.backupId2) {
      throw new AppError("VALIDATION_FAILED", "Dua backup ID diperlukan.", 422);
    }
    const diff = await deps.backups.compareBackups(workspace.userId, body.backupId1, body.backupId2);
    if (!diff) throw new AppError("NOT_FOUND", "Backup tidak ditemukan atau tidak memiliki konten.", 404);
    return c.json({ diff });
  });

  // POST /api/backups/compare-live — diff backup vs current
  app.post("/compare-live", async (c) => {
    const workspace = c.get("workspace");
    if (!workspace) throw new AppError("UNAUTHORIZED", "Login diperlukan.", 401);
    const body = await c.req.json() as { backupId: string; connectionId: string };
    if (!body.backupId || !body.connectionId) {
      throw new AppError("VALIDATION_FAILED", "Backup ID dan connection ID diperlukan.", 422);
    }
    const diff = await deps.backups.compareWithLive(workspace.userId, body.backupId, body.connectionId);
    if (!diff) throw new AppError("NOT_FOUND", "Backup atau router tidak tersedia.", 404);
    return c.json({ diff });
  });

  // GET /api/backups/:id — get detail + content
  app.get("/:id", async (c) => {
    const workspace = c.get("workspace");
    if (!workspace) throw new AppError("UNAUTHORIZED", "Login diperlukan.", 401);
    const backup = await deps.backups.getBackup(workspace.userId, c.req.param("id"));
    if (!backup) throw new AppError("NOT_FOUND", "Backup tidak ditemukan.", 404);
    return c.json({ backup });
  });

  // GET /api/backups/:id/export — download
  app.get("/:id/export", async (c) => {
    const workspace = c.get("workspace");
    if (!workspace) throw new AppError("UNAUTHORIZED", "Login diperlukan.", 401);
    const backup = await deps.backups.getBackup(workspace.userId, c.req.param("id"));
    if (!backup?.content) throw new AppError("NOT_FOUND", "Backup tidak ditemukan atau tidak memiliki konten.", 404);
    const filename = `${backup.name.replace(/[^a-zA-Z0-9._-]/g, "_")}.rsc`;
    c.header("Content-Type", "text/plain; charset=utf-8");
    c.header("Content-Disposition", `attachment; filename="${filename}"`);
    return c.body(backup.content);
  });

  // DELETE /api/backups/:id
  app.delete("/:id", async (c) => {
    const workspace = c.get("workspace");
    if (!workspace) throw new AppError("UNAUTHORIZED", "Login diperlukan.", 401);
    await deps.backups.removeBackup(workspace.userId, c.req.param("id"));
    return c.json({ ok: true });
  });

  return app;
}
