import type { TransactionCoordinator } from "../transactions/coordinator";
import { buildSystemInstruction } from "../agent/instructions";
import type { Database } from "../db";
import { createChatRoutes } from "./chat";
import { AppError } from "../lib/errors";
import type { Logger } from "../lib/logger";
import type { AgentLoop } from "../agent/loop";
import { RunEventHub } from "../agent/hub";
import { Hono } from "hono";
import type { Env } from "../types";
import type { WorkspaceContext } from "../lib/workspace";

/** Minimal transaction lifecycle surface used by chat runs (subset of TransactionCoordinator). */
export interface StubTransactions {
  begin: TransactionCoordinator["begin"];
  commit: (txId: string, userId: string) => Promise<{ state: string }>;
  rollback: (txId: string, userId: string, meta: { reason: string }) => Promise<{ state: string }>;
  getActionCount: (txId: string) => number;
}

/** Builds a chat route app with stubbed loop/provider/storage for tests. */
export function buildTestChatApp(
  db: Database,
  logger: Logger,
  opts: {
    runRateLimit: { maxRuns: number; windowMs: number };
    removeAttachmentObject?: (input: { userId: string; objectKey: string }) => Promise<void>;
    loop?: AgentLoop;
    client?: import("../agent/chat-client").ChatClient;
    executeTool?: Parameters<typeof createChatRoutes>[0]["executeTool"];
    connectors?: {
      getMode: () => Promise<{ mode: "read-only" | "write"; version: number }>;
      requireOwned: () => () => Promise<{ routerIdentity: string | null; host: string; status?: string }>;
      decryptCredential?: (userId: string, connectionId: string) => Promise<string>;
    };
    transactions?: StubTransactions;
  },
) {
  const noopLoop = {
    run: async () => ({ status: "completed" as const }),
    cancel: () => {},
    isCancelled: () => false,
    has: () => false,
  } as unknown as AgentLoop;
  const hub = new RunEventHub();
  const noopTransactions = opts.transactions ?? {
    begin: async () => ({ transactionId: "tx-test" }),
    commit: async () => ({ state: "committed" as const }),
    rollback: async () => ({ state: "rolled_back" as const }),
    getActionCount: () => 0,
  };
  const routes = createChatRoutes({
    db,
    logger,
    loop: opts.loop ?? noopLoop,
    hub,
    connectors: (opts.connectors ?? {
      getMode: async () => ({ mode: "read-only" as const, version: 1 }),
      requireOwned: () => async () => ({ routerIdentity: "test-router", host: "test" }),
      decryptCredential: async () => "test-secret",
    }) as never,
    transactions: noopTransactions,
    getProvider: async () => null,
    makeClient: () => {
      throw new Error("not needed in tests");
    },
    makeMockClient: () => opts.client ?? ({ modelLabel: "test", async *stream() { yield { type: "done" as const }; } }),
    executeTool: opts.executeTool ?? (async () => ({ ok: false, output: "stub", errorCode: "TOOL_UNSUPPORTED" })),
    executeDocsTool: async () => ({ ok: true, output: "stub" }),
    buildInstruction: buildSystemInstruction,
    loadAttachmentContent: async () => null,
    removeAttachmentObject: opts.removeAttachmentObject ?? (async () => {}),
    limits: { maxSteps: 2, maxToolCalls: 2, runTimeoutMs: 1000, maxTokens: 10 },
    runRateLimit: opts.runRateLimit,
  });

  const app = new Hono<Env>();
  let testWorkspace: WorkspaceContext | null = null;
  app.use("*", async (c, next) => {
    c.set("workspace" as never, testWorkspace as never);
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
    testWorkspace = { userId };
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

  return { call, hub };
}
