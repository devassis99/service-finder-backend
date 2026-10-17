import { afterAll, describe, expect, it, vi } from "vitest";

/** With Valkey unreachable, every read loads from the database — the same work as with no cache. */
vi.mock("../config/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../config/env")>();
  return { env: { ...actual.env, REDIS_URL: "redis://127.0.0.1:1", REDIS_CLUSTER: false } };
});

import { bumpAccountData, cachedForAccount } from "./account-cache";
import { closeRedis } from "./redis";

describe("account cache with Valkey unreachable", () => {
  afterAll(async () => {
    await closeRedis();
  });

  it("loads every time, and a change is harmless", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const load = vi.fn(async () => "fresh");
    expect(await cachedForAccount("acct", "staff:1", 60_000, load)).toBe("fresh");
    expect(await cachedForAccount("acct", "staff:1", 60_000, load)).toBe("fresh");
    await expect(bumpAccountData("acct")).resolves.toBeUndefined();
    expect(load).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });
});
