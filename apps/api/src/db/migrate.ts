import { databaseSsl, runMigrations } from "@service-finder/db";
import { env } from "../config/env";

/**
 * Programmatic migration runner — use this in deploy pipelines
 * (pnpm db:migrate, and the migrate task's `node dist/db/migrate.js`)
 * instead of shelling out to the drizzle-kit CLI in production, since it
 * needs nothing but the compiled app + pg. The migrations themselves ship
 * inside @service-finder/db, beside the schema they were generated from.
 *
 * Connects via DIRECT_DATABASE_URL, bypassing PgBouncer: migrations run
 * DDL and drizzle-kit takes an advisory lock, neither of which is safe
 * through transaction-mode connection pooling.
 */
async function main() {
  console.log("Running migrations...");
  await runMigrations({
    url: env.DIRECT_DATABASE_URL,
    ssl: databaseSsl(env.DATABASE_CA_BUNDLE_PATH),
  });
  console.log("Migrations completed.");
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
