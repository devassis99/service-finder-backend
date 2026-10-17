import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * account-cache.ts against a real Valkey (or Redis). Skipped unless
 * TEST_REDIS_URL is set:
 *
 *   TEST_REDIS_URL=redis://localhost:6380 pnpm --filter @service-finder/api exec vitest run src/shared/account-cache.test.ts
 */
const url = process.env.TEST_REDIS_URL;

vi.mock("../config/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../config/env")>();
  return {
    env: {
      ...actual.env,
      REDIS_URL: process.env.TEST_REDIS_URL,
      REDIS_CLUSTER: process.env.TEST_REDIS_CLUSTER === "true",
    },
  };
});

import { bumpAccountData, cachedForAccount } from "./account-cache";
import { closeRedis, getRedis } from "./redis";

/** Writes are fire-and-forget; give one a moment to land before reading it back. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

describe.skipIf(!url)("account cache on Valkey", () => {
  beforeAll(async () => {
    const redis = getRedis()!;
    if (redis.status !== "ready") await new Promise((resolve) => redis.once("ready", resolve));
    await redis.ping();
  });
  afterAll(async () => {
    await closeRedis();
  });

  it("loads once, then serves the copy", async () => {
    const account = crypto.randomUUID();
    const load = vi.fn(async () => ({ total: 7 }));
    expect(await cachedForAccount(account, "staff:1", 60_000, load)).toEqual({ total: 7 });
    await settle();
    expect(await cachedForAccount(account, "staff:1", 60_000, load)).toEqual({ total: 7 });
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("throws the copy away when the business changes anything", async () => {
    const account = crypto.randomUUID();
    let total = 1;
    const load = vi.fn(async () => ({ total }));
    await cachedForAccount(account, "staff:1", 60_000, load);
    await settle();
    total = 2;
    await bumpAccountData(account);
    expect(await cachedForAccount(account, "staff:1", 60_000, load)).toEqual({ total: 2 });
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("never keeps a copy built across a change as if it were current", async () => {
    const account = crypto.randomUUID();
    let calls = 0;
    const load = async () => {
      calls++;
      if (calls === 1) await bumpAccountData(account); // the change lands mid-load
      return { calls };
    };
    await cachedForAccount(account, "staff:1", 60_000, load);
    await settle();
    expect(await cachedForAccount(account, "staff:1", 60_000, load)).toEqual({ calls: 2 });
  });

  it("keeps businesses apart", async () => {
    const [a, b] = [crypto.randomUUID(), crypto.randomUUID()];
    await cachedForAccount(a, "staff:1", 60_000, async () => "a");
    await cachedForAccount(b, "staff:1", 60_000, async () => "b");
    await settle();
    await bumpAccountData(b);
    const reload = async () => "reloaded";
    expect(await cachedForAccount(a, "staff:1", 60_000, reload)).toBe("a");
    expect(await cachedForAccount(b, "staff:1", 60_000, reload)).toBe("reloaded");
  });
});
