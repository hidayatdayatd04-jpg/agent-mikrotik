import type { Database } from "../db";
import { createChatRoutes } from "./chat";
import { AppError } from "../lib/errors";
import type { Logger } from "../lib/logger";
import type { AgentLoop } from "../agent/loop";
import { RunEventHub } from "../agent/hub";
import { Hono } from "hono";
import type { Env } from "../types";
import type { SessionContext } from "../services/auth";

/** Builds a chat route app with stubbed loop/provider/storage for tests. */
export function buildTestChatApp(
  db: Database,
  logger: Logger,
  opts: {
    runRateLimit: { maxRuns: number; windowMs: number };
    removeAttachmentObject?: (input: { userId: string; objectKey: string }) => Promise<void>;
  },
) {
  const noopLoop = { run: async () => {}, cancel: () => {}, isCancelled: () => false } as unknown as AgentLoop;
  const hub = new RunEventHub();
  const routes = createChatRoutes({
    db,
    logger,
    loop: noopLoop,
    hub,
    connectors: {
      getMode: async () => ({ mode: "read-only" as const, version: 1 }),
      requireOwned: () => async () => ({ routerIdentity: "test-router", host: "test" }),
    } as never,
    getProvider: async () => null,
    makeClient: () => {
      throw new Error("not needed in tests");
    },
    makeMockClient: () => {
      throw new Error("not needed in tests");
    },
    executeTool: async () => ({ ok: false, output: "stub", errorCode: "TOOL_UNSUPPORTED" }),
    executeDocsTool: async () => ({ ok: true, output: "stub" }),
    buildInstruction: () => "stub-instruction",
    loadAttachmentContent: async () => null,
    removeAttachmentObject: opts.removeAttachmentObject ?? (async () => {}),
    limits: { maxSteps: 2, maxToolCalls: 2, runTimeoutMs: 1000, maxTokens: 10 },
    runRateLimit: opts.runRateLimit,
  });

  const app = new Hono<Env>();
  let fakeSession: SessionContext | null = null;
  app.use("*", async (c, next) => {
    c.set("session" as never, fakeSession as never);
    await next();
  });
  app.route("/", routes);
  app.onError((err, c) => {
    if (err instanceof AppError) {
      return c.json({ error: { code: err.code, message: err.message, requestId: "test" } }, err.status as never);
    }
    return c.json({ error: { code: "INTERNAL_ERROR", message: String(err), requestId: "test" } }, 500);
  });

  async function call(method: "GET" | "POST" | "PATCH" | "DELETE", path: string, userId: string, body?: unknown) {
    fakeSession = { userId, email: "t@example.com", name: "t", createdAt: new Date() } as unknown as SessionContext;
    const init: RequestInit = { method };
    if (body !== undefined) {
      init.headers = { "Content-Type": "application/json" };
      init.body = JSON.stringify(body);
    }
    const res = await app.fetch(new Request(`http://test${path}`, init));
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown> & {
      error?: { code?: string; message?: string };
    };
    return { status: res.status, ok: res.ok, body: json };
  }

  return { call };
}
