import path from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import type { DatabaseSsl } from "./ssl";

/**
 * The SQL migrations drizzle-kit generates from ./schema, shipped inside
 * this package. Found next to the package rather than in the working
 * directory, so it is the same folder whether this runs from src/ (tsx),
 * dist/ (a local build) or node_modules/@service-finder/db (an app's image).
 */
export const migrationsFolder = path.join(__dirname, "..", "drizzle");

/**
 * Applies every pending migration — what an app's deploy-time migration
 * task runs, since it needs nothing but the compiled app + pg.
 *
 * Give it the direct connection (DIRECT_DATABASE_URL), bypassing
 * PgBouncer: migrations run DDL and drizzle takes an advisory lock,
 * neither of which is safe through transaction-mode connection pooling.
 */
export async function runMigrations({ url, ssl }: { url: string; ssl: DatabaseSsl }) {
  const pool = new Pool({ connectionString: url, ssl, max: 1 });
  try {
    await migrate(drizzle(pool), { migrationsFolder });
  } finally {
    await pool.end();
  }
}
