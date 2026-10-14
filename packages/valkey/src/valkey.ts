import { Cluster, Redis, ReplyError, type ClusterOptions, type RedisOptions } from "ioredis";

/**
 * Connections to Valkey/Redis — ElastiCache Serverless for Valkey in AWS,
 * docker compose's Valkey locally — the way every Service Finder service opens
 * them.
 *
 * Cluster mode when `cluster` is true. ElastiCache Serverless speaks
 * nothing else, and it changes one rule for everybody who writes a
 * command: every key a single command or Lua script touches must hash to
 * the same slot. Keys share a slot through a hash tag — the part inside
 * `{...}`.
 *
 * Nothing here reads the environment: an app says where its Valkey is,
 * from its own validated config.
 */

export type RedisClient = Redis | Cluster;

export interface ValkeyConfig {
  /** redis:// or rediss:// (TLS). Unset or empty: there is no Valkey. */
  url?: string;
  /** True for ElastiCache Serverless, which only speaks cluster mode. */
  cluster?: boolean;
}

const COMMAND_TIMEOUT_MS = 1000;

/**
 * No answer from Valkey — it isn't configured, can't be reached, or didn't
 * reply in time. Every caller decides what that means for it: a cache
 * reads straight from the database instead, a rate limit lets the
 * attempt through uncounted, a reservation can't be taken.
 */
export class CacheUnavailableError extends Error {
  constructor(message = "Valkey is unavailable") {
    super(message);
    this.name = "CacheUnavailableError";
  }
}

export interface ValkeyClientOptions {
  /** True for ElastiCache Serverless, which only speaks cluster mode. */
  cluster?: boolean;
  /**
   * A connection that will only ever (s)subscribe. It waits rather than
   * fails: a subscription asked for while still connecting is sent once
   * the connection is up, and every subscription is renewed by itself
   * after a reconnect. In cluster mode it also opens one subscriber per
   * shard, which SSUBSCRIBE needs.
   */
  subscriber?: boolean;
}

/**
 * A new client. Most code wants the one shared client `createValkey`
 * keeps; this is for the connections that can't be shared — a pub/sub
 * subscriber, say, which can run nothing but (un)subscribe once it starts.
 */
export function createValkeyClient(url: string, options: ValkeyClientOptions = {}): RedisClient {
  const parsed = new URL(url);
  const tls = parsed.protocol === "rediss:";
  const common: RedisOptions = {
    username: parsed.username ? decodeURIComponent(parsed.username) : undefined,
    password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
    tls: tls ? {} : undefined,
    connectTimeout: 5000,
    ...(options.subscriber
      ? {
          // Nobody is waiting on a subscription the way a request waits on
          // a command, so there is nothing to time out: keep trying.
          maxRetriesPerRequest: null,
          enableOfflineQueue: true,
        }
      : {
          commandTimeout: COMMAND_TIMEOUT_MS,
          maxRetriesPerRequest: 1,
          // Never queue a command while disconnected. A queued command runs
          // whenever the connection comes back — minutes after the request
          // that sent it was told "unavailable" — and for a reservation that
          // means something held for nobody. Failing at once is the honest answer.
          enableOfflineQueue: false,
        }),
  };

  if (!options.cluster) {
    return new Redis({
      ...common,
      host: parsed.hostname,
      port: Number(parsed.port || 6379),
      db: parsed.pathname.length > 1 ? Number(parsed.pathname.slice(1)) : 0,
    });
  }

  const clusterOptions: ClusterOptions = {
    redisOptions: common,
    // ElastiCache hands back node addresses its TLS certificate is issued
    // for by name; resolving them to IPs first makes the certificate check
    // fail. Passing the name through untouched is AWS's own advice.
    dnsLookup: (address, callback) => callback(null, address),
    slotsRefreshTimeout: 2000,
    enableOfflineQueue: options.subscriber === true,
    shardedSubscribers: options.subscriber === true,
  };
  return new Cluster(
    [{ host: parsed.hostname, port: Number(parsed.port || 6379) }],
    clusterOptions,
  );
}

const DEADLINE_MS = 1500;

/**
 * The one Valkey connection a process keeps, and a deadline on every use
 * of it.
 *
 * `config` is read when the connection is first needed, not when this is
 * called, so a job that never touches Valkey (a migration, a seed)
 * never opens a connection, and a process with no URL configured
 * can still start: `getRedis()` answers null and each caller decides what
 * "no cache" means for it.
 *
 * Every call goes through `withRedis`, which gives it a deadline. A cache
 * that has gone away must turn into a fast, clear "unavailable", not a
 * request that hangs until the load balancer gives up on it — and that has
 * to hold while the client is still connecting, too, when ioredis queues
 * commands rather than sending them.
 */
export function createValkey(config: () => ValkeyConfig) {
  let client: RedisClient | null = null;

  /** The shared client, or null when no URL is configured. */
  function getRedis(): RedisClient | null {
    const { url, cluster } = config();
    if (!url) return null;
    if (!client) {
      client = createValkeyClient(url, { cluster });
      // Logged, never thrown: ioredis reconnects on its own, and an
      // unhandled "error" event would take the whole process down with it.
      client.on("error", (error: Error) => {
        console.error("[redis] connection error:", error.message);
      });
    }
    return client;
  }

  /**
   * Runs `fn` against the shared client with a deadline. Throws
   * CacheUnavailableError when there is no cache configured, or it doesn't
   * answer in time; the caller decides whether that is fatal (taking a
   * reservation) or ignorable (a rate limit failing open).
   */
  async function withRedis<T>(
    fn: (redis: RedisClient, deadline: { passed: boolean }) => Promise<T>,
  ): Promise<T> {
    const redis = getRedis();
    if (!redis) throw new CacheUnavailableError();
    // Handed to fn so a multi-step write can tell, after each step, that
    // nobody is waiting for it any more and undo what it just did.
    const state = { passed: false };
    let timer: NodeJS.Timeout | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        state.passed = true;
        reject(new CacheUnavailableError());
      }, DEADLINE_MS);
    });
    const work = fn(redis, state);
    // If the deadline wins, the command's own failure arrives later with
    // nobody waiting for it — swallowed here so it can't surface as an
    // unhandled rejection, which would end the process.
    work.catch(() => undefined);
    try {
      return await Promise.race([work, deadline]);
    } catch (error) {
      if (error instanceof CacheUnavailableError) throw error;
      // A connection or timeout error from the client itself is the same
      // thing to a caller: no answer. A reply the server sent back (a
      // script's own error, a wrong-type key) is not — that is a bug, and
      // should surface as one.
      if (error instanceof ReplyError) throw error;
      if (
        error instanceof Error &&
        /connect|timed? ?out|isn't ready|ECONN|ETIMEDOUT|EHOSTUNREACH|ENOTFOUND|Stream isn't writeable|max retries|ClusterAllFailed|refresh slots|None of startup nodes/i.test(
          `${error.name} ${error.message}`,
        )
      ) {
        throw new CacheUnavailableError();
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Opens the connection at boot, so the first caller of the day isn't the
   * one who waits for it.
   *
   * On a cluster that means every node's connection, not just the one the
   * client first talks to: the client never queues, so a command for a
   * node still connecting fails outright until something happens to open
   * it. Best effort, never awaited by anyone.
   */
  function warmRedis(): void {
    const redis = getRedis();
    if (!redis || !("nodes" in redis)) return;
    redis.once("ready", () => {
      void Promise.all(redis.nodes("master").map((node) => node.ping())).catch(() => {});
    });
  }

  /** For shutdown and tests. */
  async function closeRedis(): Promise<void> {
    if (!client) return;
    const closing = client;
    client = null;
    await closing.quit().catch(() => closing.disconnect());
  }

  return { getRedis, withRedis, warmRedis, closeRedis };
}

export type Valkey = ReturnType<typeof createValkey>;
