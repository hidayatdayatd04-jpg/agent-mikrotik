import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import { drizzle as drizzlePg, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

export type Database = NodePgDatabase<typeof schema> | ReturnType<typeof createNeonDb>;

const isLocalPostgres = (url: string): boolean => {
  try {
    const u = new URL(url);
    const host = u.hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "host.docker.internal";
  } catch {
    return false;
  }
};

function createNeonDb(connectionString: string) {
  const sql = neon(connectionString);
  return drizzle(sql, { schema });
}

/**
 * Neon (production) uses the serverless HTTP driver against DATABASE_URL (pooled).
 * Local dev Postgres uses node-postgres because neon-http requires Neon's WebSocket proxy.
 */
export function createDb(connectionString: string): Database {
  if (isLocalPostgres(connectionString)) {
    const pool = new Pool({ connectionString });
    return drizzlePg(pool, { schema });
  }
  return createNeonDb(connectionString);
}
