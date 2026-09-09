import { Hono } from "hono";
import type { Env } from "../types";
import type { Database } from "../db";
import type { Logger } from "../lib/logger";
import type { StorageService } from "../services/storage";
import { registerFileRoutes } from "./attachments/files";
import { registerListingRoutes } from "./attachments/listing";

/** Validated local attachments, served only through the API. */
export function createAttachmentRoutes(deps: {
  db: Database;
  logger: Logger;
  storage: StorageService | null;
  limits: { maxBytes: number; maxFilesPerMessage: number };
}) {
  const routes = new Hono<Env>();

  registerListingRoutes(routes, deps);
  registerFileRoutes(routes, deps);

  return routes;
}
