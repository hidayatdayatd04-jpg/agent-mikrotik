import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import { drizzle as drizzlePg, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

export type Database = NodePgDatabase<typeof schema> | ReturnType<typeof createNeonDb>;

const isNeonUrl = (url: string): boolean => {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host.endsWith(".neon.tech") || host.endsWith(".neon.build");
  } catch {
    return false;
  }
};

function createNeonDb(connectionString: string) {
  const sql = neon(connectionString);
  return drizzle(sql, { schema });
}

/**
 * Driver selection by URL shape:
 *  - *.neon.tech / *.neon.build → neon-http (serverless HTTP driver, works with
 *    Neon's proxy where node-postgres Pool from some networks gets ECONNRESET);
 *  - anything else (localhost, docker hostname, RDS/other Postgres) → node-postgres Pool.
 */
export function createDb(connectionString: string): Database {
  if (isNeonUrl(connectionString)) {
    return createNeonDb(connectionString);
  }
  const pool = new Pool({ connectionString });
  return drizzlePg(pool, { schema });
}
