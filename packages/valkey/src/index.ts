/**
 * @service-finder/valkey — how every Service Finder service connects to Valkey.
 *
 * One shared client per process with a deadline on every call
 * (`createValkey`), plus `createValkeyClient` for the connections that
 * can't be shared, like a pub/sub subscriber. An app wires it once from
 * its own config:
 *
 *   export const { getRedis, withRedis, warmRedis, closeRedis } = createValkey(() => ({
 *     url: env.REDIS_URL,
 *     cluster: env.REDIS_CLUSTER,
 *   }));
 */
export {
  CacheUnavailableError,
  createValkey,
  createValkeyClient,
  type RedisClient,
  type Valkey,
  type ValkeyClientOptions,
  type ValkeyConfig,
} from "./valkey";
