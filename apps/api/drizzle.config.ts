import "dotenv/config";
import { defineConfig } from "drizzle-kit";
import { env } from "./src/config/env";

/**
 * The schema and its migrations live in @service-finder/db (packages/db), where
 * every app can read them; the API is the one app that generates and
 * applies migrations, so drizzle-kit runs from here, against this app's
 * .env.
 */
export default defineConfig({
  dialect: "postgresql",
  schema: "../../packages/db/src/schema/index.ts",
  out: "../../packages/db/drizzle",
  // drizzle-kit talks to Postgres directly — never through PgBouncer
  // (transaction pooling breaks DDL and migration locking).
  dbCredentials: {
    url: env.DIRECT_DATABASE_URL,
  },
  // Only ever generate/introspect against our own schema — never touch
  // `public` or anything else that might exist in the same database.
  schemaFilter: ["service_finder"],
  strict: true,
  verbose: true,
});
