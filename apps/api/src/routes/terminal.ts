import { Hono } from "hono";
import type { Env } from "../types";
import { buildTerminalDeps, type TerminalRouteDeps } from "./terminal/deps";
import { registerCommandRoutes } from "./terminal/commands";
import { registerSessionRoutes } from "./terminal/sessions";

export type { TerminalRouteDeps };

export function createTerminalRoutes(deps: TerminalRouteDeps) {
  const routes = new Hono<Env>();
  const tdeps = buildTerminalDeps(deps);

  registerSessionRoutes(routes, deps, tdeps);
  registerCommandRoutes(routes, deps, tdeps);

  return routes;
}
