import { app } from "./app";
import { env } from "./config/env";
import { closeDb, db } from "./db";
import { ensurePermissionCatalog } from "./modules/staff-roles";
import { closeRedis, warmRedis } from "./shared/redis";

async function main() {
  // Keeps the business app's permission catalog in step with the code on
  // every deploy: a no-op once every key exists, and the moment a new key
  // first lands it is granted to every business's Owner role too (see
  // ensurePermissionCatalog). Without it, a business created before the
  // key shipped would never get it.
  await ensurePermissionCatalog(db);

  const server = app.listen(env.PORT, () => {
    console.log(`service-finder-backend listening on port ${env.PORT}`);
  });

  // Sign-in rate limits live in Valkey. Without it the server still runs
  // and the limits fail open (see shared/rate-limit.ts) — said once,
  // loudly, rather than discovered during an incident.
  if (!env.REDIS_URL && env.NODE_ENV === "production") {
    console.warn(
      "REDIS_URL is not set: sign-in attempt limits are off until it is (see deploy/README.md).",
    );
  }
  warmRedis();

  /**
   * Stop accepting new connections, let in-flight requests finish, then
   * close the database pools — so a deploy/restart never cuts off a
   * request mid-flight or leaks open Postgres connections.
   */
  async function shutdown(signal: string) {
    console.log(`${signal} received, shutting down...`);

    server.close(async (err) => {
      if (err) {
        console.error("Error closing HTTP server", err);
        process.exitCode = 1;
      }

      try {
        await closeRedis();
        await closeDb();
      } catch (dbErr) {
        console.error("Error closing database pools", dbErr);
        process.exitCode = 1;
      }

      process.exit();
    });
  }

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err) => {
  console.error("Failed to start service-finder-backend", err);
  process.exit(1);
});
