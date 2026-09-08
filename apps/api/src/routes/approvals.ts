import { Hono } from "hono";
import type { Env as HonoEnv } from "../types";
import { AppError } from "../lib/errors";
import type { ApprovalService } from "../services/approval";
import type { ToolExecutor } from "../agent/tool-executor";

export function createApprovalRoutes(deps: { approvals: ApprovalService; executeTool: ToolExecutor }) {
  const app = new Hono<HonoEnv>();

  // GET /api/approvals
  app.get("/", async (c) => {
    const workspace = c.get("workspace");
    if (!workspace) throw new AppError("UNAUTHORIZED", "Login diperlukan.", 401);
    const status = c.req.query("status") as "pending" | "approved" | "rejected" | "expired" | "executed" | "failed" | undefined;
    const connectionId = c.req.query("connectionId") ?? undefined;
    const conversationId = c.req.query("conversationId") ?? undefined;
    const items = await deps.approvals.list(workspace.userId, { status, connectionId, conversationId });
    return c.json({ approvals: items });
  });

  // POST /api/approvals — create request
  app.post("/", async (c) => {
    const workspace = c.get("workspace");
    if (!workspace) throw new AppError("UNAUTHORIZED", "Login diperlukan.", 401);
    const body = await c.req.json();
    if (!body.connectionId || !body.summary || !Array.isArray(body.operations) || body.operations.length === 0) {
      throw new AppError("VALIDATION_FAILED", "connectionId, summary, dan operations diperlukan.", 422);
    }
    const item = await deps.approvals.createRequest({
      userId: workspace.userId,
      connectionId: body.connectionId,
      runId: body.runId,
      conversationId: body.conversationId,
      summary: body.summary,
      operations: body.operations,
      riskLevel: body.riskLevel ?? "medium",
      impactDescription: body.impactDescription,
      affectedObjects: body.affectedObjects,
      expiresInMs: body.expiresInMs,
    });
    return c.json({ approval: item }, 201);
  });

  // GET /api/approvals/:id
  app.get("/:id", async (c) => {
    const workspace = c.get("workspace");
    if (!workspace) throw new AppError("UNAUTHORIZED", "Login diperlukan.", 401);
    const item = await deps.approvals.get(workspace.userId, c.req.param("id"));
    if (!item) throw new AppError("NOT_FOUND", "Approval request tidak ditemukan.", 404);
    return c.json({ approval: item });
  });

  // POST /api/approvals/:id/approve
  app.post("/:id/approve", async (c) => {
    const workspace = c.get("workspace");
    if (!workspace) throw new AppError("UNAUTHORIZED", "Login diperlukan.", 401);
    const approval = await deps.approvals.approve(workspace.userId, c.req.param("id"));
    return c.json({ approval });
  });

  // POST /api/approvals/:id/reject
  app.post("/:id/reject", async (c) => {
    const workspace = c.get("workspace");
    if (!workspace) throw new AppError("UNAUTHORIZED", "Login diperlukan.", 401);
    const body = await c.req.json().catch(() => ({})) as { reason?: string };
    const approval = await deps.approvals.reject(workspace.userId, c.req.param("id"), body.reason);
    return c.json({ approval });
  });

  // POST /api/approvals/:id/execute
  app.post("/:id/execute", async (c) => {
    const workspace = c.get("workspace");
    if (!workspace) throw new AppError("UNAUTHORIZED", "Login diperlukan.", 401);

    const executeFn = (input: { userId: string; connectionId: string; fqName: string; args: unknown }) =>
      deps.executeTool({
        userId: input.userId,
        connectionId: input.connectionId,
        fqName: input.fqName,
        args: input.args,
      });

    const approval = await deps.approvals.execute(workspace.userId, c.req.param("id"), executeFn);
    return c.json({ approval });
  });

  // GET /api/approvals/:id/log
  app.get("/:id/log", async (c) => {
    const workspace = c.get("workspace");
    if (!workspace) throw new AppError("UNAUTHORIZED", "Login diperlukan.", 401);
    const log = await deps.approvals.getOperationLog(workspace.userId, c.req.param("id"));
    return c.json({ log });
  });

  return app;
}
