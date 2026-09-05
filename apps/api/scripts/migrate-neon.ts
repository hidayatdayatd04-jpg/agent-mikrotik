import { migrate } from "drizzle-orm/neon-http/migrator";
import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";

/**
 * Migrations for Neon over the neon-http driver. Node-postgres connections to
 * the Neon pooler endpoint are reset from this network, so Neon databases are
 * migrated through neon-http (serverless HTTP driver) instead.
 *
 * Usage: DATABASE_URL=<neon-url> bun run scripts/migrate-neon.ts
 */
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL (Neon) required for migrations");

const sql = neon(url);
const db = drizzle(sql);

await migrate(db, { migrationsFolder: "../../drizzle" });
console.log("neon migrations applied");
