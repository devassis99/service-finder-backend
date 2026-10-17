import { CacheUnavailableError, withRedis } from "./redis";

/**
 * Read-through caches for things a business's own data decides, kept in
 * Valkey and thrown away whenever that business's data changes — iGroom's
 * design, carried across with the business app's identity.
 *
 * Today it holds the two lookups every business-app request makes before
 * it does anything else: the signed-in member's own row
 * (requireAccountAuth) and their role's permission keys
 * (requireAccountPermission). Without it, every request is two extra
 * queries just to learn who is asking.
 *
 * Invalidation is by version, not by key. Every business has one
 * counter; anything cached for it is stored with the counter's value at
 * the time, and a read that finds a different value treats the entry as
 * gone. requireAccountAuth bumps the counter after every successful
 * change made through the business app, before the response is sent — so
 * no write path has to remember which cache it affects, and the next read
 * after any change is fresh. Deactivating someone, or changing their
 * role, takes effect on their very next request.
 *
 * Values go through JSON, so what comes back is plain data (Dates become
 * ISO strings). Only cache what doesn't need to be anything more.
 *
 * Fail-open: if Valkey can't answer, every read is a miss and the loader
 * runs — the same work as with no cache at all.
 */

interface Entry<T> {
  /** The business's data version when this was built. */
  v: string;
  d: T;
}

// One hash tag per business, so a business's version and its entries
// share a cluster slot and can be read together in one MGET.
const versionKey = (accountId: string) => `service-finder:cache:{acct:${accountId}}:v`;
const entryKey = (accountId: string, name: string) =>
  `service-finder:cache:{acct:${accountId}}:${name}`;

let lastWarned = 0;
function warnUnavailable(error: unknown) {
  if (!(error instanceof CacheUnavailableError)) {
    console.error("[cache]", error);
    return;
  }
  if (Date.now() - lastWarned < 60_000) return;
  lastWarned = Date.now();
  console.warn("[cache] Valkey unavailable — reading straight from the database");
}

function parse<T>(raw: string | null): Entry<T> | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Entry<T>;
  } catch {
    return null;
  }
}

/**
 * Marks everything cached for this business as out of date. Awaited by
 * requireAccountAuth before a change's response goes out, so the client's
 * next read can't see the old copy. Never throws.
 */
export async function bumpAccountData(accountId: string): Promise<void> {
  await withRedis(async (client) => {
    await client.incr(versionKey(accountId));
  }).catch(warnUnavailable);
}

/**
 * `load()`, or its result from the last `ttlMs` if nothing about the
 * business has changed since. The version is read *before* loading and
 * stored with the result, so a change that lands while loading leaves an
 * entry that is already out of date — never a stale one marked current.
 */
export async function cachedForAccount<T>(
  accountId: string,
  name: string,
  ttlMs: number,
  load: () => Promise<T>,
): Promise<T> {
  const key = entryKey(accountId, name);
  let version: string;
  try {
    const [current, raw] = await withRedis((client) => client.mget(versionKey(accountId), key));
    version = current ?? "0";
    const entry = parse<T>(raw);
    if (entry && entry.v === version) return entry.d;
  } catch (error) {
    warnUnavailable(error);
    return load();
  }

  const data = await load();
  void withRedis(async (client) => {
    await client.set(key, JSON.stringify({ v: version, d: data } satisfies Entry<T>), "PX", ttlMs);
  }).catch(warnUnavailable);
  return data;
}
