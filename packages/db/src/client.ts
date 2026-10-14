import { drizzle } from "drizzle-orm/node-postgres";
import { withReplicas } from "drizzle-orm/pg-core";
import { Pool } from "pg";
import * as schema from "./schema";
import type { DatabaseSsl } from "./ssl";

export interface DatabaseConfig {
  /** The primary — or PgBouncer in front of it, once there is one. */
  url: string;
  /** Read replicas. Empty (local dev): every read goes to the primary. */
  replicaUrls?: string[];
  /** From `databaseSsl(DATABASE_CA_BUNDLE_PATH)`. */
  ssl: DatabaseSsl;
  /** Connections per pool, per process. */
  max?: number;
}

/**
 * One pooled pg.Pool per Postgres endpoint (primary + each replica),
 * created once per process and reused — never instantiate a Pool per request.
 *
 * These connect via DATABASE_URL / DATABASE_REPLICA_URLS, which is where
 * PgBouncer goes once it's introduced (point those env vars at PgBouncer's
 * port instead of Postgres directly — no code changes needed here).
 * `pg` sends parameterized queries as unnamed prepared statements per
 * query by default, which is safe under PgBouncer's transaction pooling
 * mode. What ISN'T safe through transaction pooling: LISTEN/NOTIFY,
 * session-level SET/RESET outside a transaction, and advisory locks —
 * avoid those on this pool once PgBouncer is in front of it. Because
 * PgBouncer already pools the real Postgres connections, keep `max` here
 * modest per app instance rather than scaling it up — you don't want two
 * stacked, oversized pools.
 *
 * A pool opens no connection until its first query, so creating one at
 * startup costs nothing for a process that never queries.
 */
function createPool(connectionString: string, ssl: DatabaseSsl, max: number) {
  const pool = new Pool({
    connectionString,
    ssl,
    // tune for your workload / hosting provider
    max,
    idleTimeoutMillis: 30_000,
  });

  pool.on("error", (err) => {
    // Idle client errors (e.g. network blip) should not crash the process.
    console.error("Unexpected error on idle Postgres client", err);
  });

  return pool;
}

/**
 * The database, for an app to create once at startup from its own config.
 *
 * `db` transparently routes SELECTs to a read replica and all writes
 * (INSERT/UPDATE/DELETE) to the primary. With no replicas (e.g. local
 * dev), it falls back to the primary for everything.
 *
 * Use `db.$primary` to force a read against the primary — needed for
 * read-after-write consistency (e.g. re-reading a row you just wrote,
 * before replication has caught up).
 */
export function createDatabase({ url, replicaUrls = [], ssl, max = 10 }: DatabaseConfig) {
  const primaryPool = createPool(url, ssl, max);
  const primaryDb = drizzle(primaryPool, { schema });

  const replicaPools = replicaUrls.map((replicaUrl) => createPool(replicaUrl, ssl, max));
  const replicaDbs = replicaPools.map((replicaPool) => drizzle(replicaPool, { schema }));

  const db = withReplicas(
    primaryDb,
    replicaDbs.length > 0
      ? (replicaDbs as [typeof primaryDb, ...(typeof primaryDb)[]])
      : [primaryDb],
  );

  /** Close every pool (primary + replicas) — call on process shutdown. */
  async function close() {
    await Promise.all([primaryPool.end(), ...replicaPools.map((p) => p.end())]);
  }

  return { db, close };
}

export type Database = ReturnType<typeof createDatabase>["db"];

/**
 * The `tx` param type inside `db.$primary.transaction(async (tx) => {...})`
 * calls — extracted so functions that need to run either standalone
 * (against `db`) or inside an existing transaction (against `tx`) can
 * accept either without duplicating logic.
 */
export type DbTx = Parameters<Parameters<Database["$primary"]["transaction"]>[0]>[0];
