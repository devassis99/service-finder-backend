/**
 * @service-finder/db — Service Finder's Postgres: the schema, its migrations, and how to
 * connect.
 *
 * Every table lives in ./schema (imported as "@service-finder/db/schema"), and the
 * migrations generated from it live in ../drizzle, beside it. Any app can
 * read and write the database through this package; only the API
 * generates and applies migrations (`pnpm db:generate`, `pnpm db:migrate`,
 * and its deploy-time migrate task), so there is one owner of the schema's
 * history.
 *
 * Nothing here reads the environment. An app creates its database once,
 * from its own validated config:
 *
 *   export const { db, close } = createDatabase({
 *     url: env.DATABASE_URL,
 *     replicaUrls: env.DATABASE_REPLICA_URLS,
 *     ssl: databaseSsl(env.DATABASE_CA_BUNDLE_PATH),
 *   });
 */
export { createDatabase, type Database, type DatabaseConfig, type DbTx } from "./client";
export { migrationsFolder, runMigrations } from "./migrations";
export { databaseSsl, type DatabaseSsl } from "./ssl";
