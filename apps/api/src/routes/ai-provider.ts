import { Hono } from "hono";
import type { Env } from "../types";
import { registerProviderRoutes } from "./ai-provider/providers";
import { registerRateLimitRoutes } from "./ai-provider/rate-limits";
import type { AiProviderRouteCtx, AiProviderRouteDeps } from "./ai-provider/ctx";

export type { AiProviderRouteDeps };

/**
 * AI provider settings + model auto-fetch (Multi-Provider with isolation).
 * The API key is submitted to save or transiently to fetch models — it is never
 * returned by any GET.
 */
export function createAiProviderRoutes(deps: AiProviderRouteDeps) {
  const routes = new Hono<Env>();
  const ctx: AiProviderRouteCtx = {
    deps,
    modelCache: new Map<string, { until: number; value: Record<string, unknown> }>(),
  };

  // Didefinisikan SEBELUM "/:id" agar tidak tertangkap param.
  registerRateLimitRoutes(routes, ctx);
  registerProviderRoutes(routes, ctx);

  return routes;
}
