import { createDatabase, databaseSsl } from "@service-finder/db";
import { env } from "../config/env";

/**
 * This process's database — see @service-finder/db (packages/db/src/client.ts)
 * for the pools, the read replicas and `db.$primary`.
 */
const database = createDatabase({
  url: env.DATABASE_URL,
  replicaUrls: env.DATABASE_REPLICA_URLS,
  ssl: databaseSsl(env.DATABASE_CA_BUNDLE_PATH),
});

export const db = database.db;

/** Close every pool (primary + replicas) — call on process shutdown. */
export const closeDb = database.close;

export type { Database, DbTx } from "@service-finder/db";
