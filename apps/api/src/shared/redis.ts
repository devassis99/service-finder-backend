import { createValkey } from "@service-finder/valkey";
import { env } from "../config/env";

/**
 * This process's one Valkey connection — see @service-finder/valkey
 * (packages/valkey/src/valkey.ts) for how it connects, and why every call
 * has a deadline.
 *
 * Read from env when first used rather than now, so a job that never
 * touches Valkey (the migration, a seed) never opens a
 * connection, and a process with REDIS_URL unset can still start.
 */
export const { getRedis, withRedis, warmRedis, closeRedis } = createValkey(() => ({
  url: env.REDIS_URL,
  cluster: env.REDIS_CLUSTER,
}));

export { CacheUnavailableError, type RedisClient } from "@service-finder/valkey";
