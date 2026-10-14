import { afterAll, describe, expect, it } from "vitest";
import { CacheUnavailableError, createValkey } from "./valkey";

/**
 * A cache that isn't there must answer fast and plainly — the API's rate
 * limits turn CacheUnavailableError into "let it through, uncounted", and
 * anything stricter into a clear 503. Pointed at a port nothing
 * listens on, so no server is needed.
 */
const unreachable = createValkey(() => ({ url: "redis://127.0.0.1:1", cluster: false }));
const unconfigured = createValkey(() => ({ url: undefined }));

afterAll(async () => {
  await unreachable.closeRedis();
});

describe("withRedis", () => {
  it("turns an unreachable cache into CacheUnavailableError, within its deadline", async () => {
    const started = Date.now();
    await expect(unreachable.withRedis((redis) => redis.get("anything"))).rejects.toBeInstanceOf(
      CacheUnavailableError,
    );
    expect(Date.now() - started).toBeLessThan(2500);
  });

  it("answers CacheUnavailableError at once when no URL is configured", async () => {
    expect(unconfigured.getRedis()).toBeNull();
    await expect(unconfigured.withRedis((redis) => redis.get("anything"))).rejects.toBeInstanceOf(
      CacheUnavailableError,
    );
  });
});
