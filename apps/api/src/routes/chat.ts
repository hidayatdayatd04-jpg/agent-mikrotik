import { Hono } from "hono";
import type { Env } from "../types";
import { registerConversationRoutes } from "./chat/conversations";
import { registerConversationDelete } from "./chat/conversation-delete";
import { registerConversationExport } from "./chat/conversation-export";
import { registerMessageRoutes } from "./chat/messages";
import { registerRunRoutes } from "./chat/runs";
import { registerRunEventRoutes } from "./chat/run-events";
import type { ChatCtx, ChatRouteDeps } from "./chat/types";

export type { ChatRouteDeps } from "./chat/types";

/**
 * Conversations + runs (M7). Runs execute in the background (agent loop) and
 * publish events to the hub; browsers attach via SSE. The start endpoint is
 * idempotent per (conversationId, idempotencyKey). Write runs open Safe Mode
 * before the loop and settle it before publishing the terminal run event.
 */
export function createChatRoutes(deps: ChatRouteDeps) {
  const routes = new Hono<Env>();

  // in-process sliding window per user (M10): simple and restart-safe enough
  // for the single-node dev deployment; a shared store is a production TODO
  const ctx: ChatCtx = {
    deps,
    backgroundRuns: new Map<string, string>(),
    runTimesByUser: new Map<string, number[]>(),
  };

  registerConversationRoutes(routes, ctx);
  registerConversationDelete(routes, ctx);
  registerConversationExport(routes, ctx);
  registerMessageRoutes(routes, ctx);
  registerRunRoutes(routes, ctx);
  registerRunEventRoutes(routes, ctx);

  return routes;
}
