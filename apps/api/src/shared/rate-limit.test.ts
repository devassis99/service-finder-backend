import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * rate-limit.ts against a real Valkey (or Redis): the counting, the
 * refusal, what a success gives back and how a burst of simultaneous
 * attempts is held to the limit are properties of the scripts, so they
 * are tested on a server. Skipped unless TEST_REDIS_URL is set:
 *
 *   TEST_REDIS_URL=redis://localhost:6379 pnpm test src/shared/rate-limit.test.ts
 *
 * The fail-open case lives in rate-limit.unavailable.test.ts.
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

import {
  TooManyAttemptsError,
  deviceLimit,
  mfaCodeLimits,
  takeAttempt,
  type AttemptLimit,
} from "./rate-limit";
import { closeRedis, getRedis } from "./redis";

const message = (minutes: number) => `wait ${minutes}`;
const fresh = (overrides: Partial<AttemptLimit> = {}): AttemptLimit => ({
  name: "test",
  subject: crypto.randomUUID(),
  max: 3,
  windowMs: 60_000,
  ...overrides,
});

async function attempts(limits: AttemptLimit[], n: number) {
  const outcomes: ("ok" | "refused")[] = [];
  for (let i = 0; i < n; i++) {
    try {
      // oxlint-disable-next-line no-await-in-loop
      await takeAttempt(limits, message);
      outcomes.push("ok");
    } catch (error) {
      if (!(error instanceof TooManyAttemptsError)) throw error;
      outcomes.push("refused");
    }
  }
  return outcomes;
}

describe.skipIf(!url)("attempt limits on Valkey", () => {
  beforeAll(async () => {
    const redis = getRedis()!;
    if (redis.status !== "ready") await new Promise((resolve) => redis.once("ready", resolve));
    await redis.ping();
  });
  afterAll(async () => {
    await closeRedis();
  });

  it("lets `max` attempts through in a window and refuses the next, with how long to wait", async () => {
    const limit = fresh({ max: 3, windowMs: 120_000 });
    expect(await attempts([limit], 3)).toEqual(["ok", "ok", "ok"]);
    const refusal = await takeAttempt([limit], message).catch((error: unknown) => error);
    expect(refusal).toBeInstanceOf(TooManyAttemptsError);
    const { retryAfterSeconds, message: text } = refusal as TooManyAttemptsError;
    expect(retryAfterSeconds).toBeGreaterThan(110);
    expect(retryAfterSeconds).toBeLessThanOrEqual(120);
    expect(text).toBe("wait 2");
  });

  it("holds a burst of simultaneous attempts to the limit — counted before, not after", async () => {
    const limit = fresh({ max: 10 });
    const results = await Promise.allSettled(
      Array.from({ length: 40 }, () => takeAttempt([limit], message)),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(10);
  });

  it("takes a successful attempt back, so only failures add up", async () => {
    const limit = fresh({ max: 2 });
    for (let i = 0; i < 5; i++) {
      // oxlint-disable-next-line no-await-in-loop
      const attempt = await takeAttempt([limit], message);
      // oxlint-disable-next-line no-await-in-loop
      await attempt.succeeded();
    }
    expect(await attempts([limit], 3)).toEqual(["ok", "ok", "refused"]);
  });

  it("clears a resetOnSuccess counter outright", async () => {
    const limit = fresh({ max: 3, resetOnSuccess: true });
    await attempts([limit], 2);
    const attempt = await takeAttempt([limit], message);
    await attempt.succeeded();
    expect(await attempts([limit], 4)).toEqual(["ok", "ok", "ok", "refused"]);
  });

  it("doesn't run up the wider counters with attempts already stopped at a narrow one", async () => {
    const narrow = fresh({ max: 2 });
    const wide = fresh({ max: 5 });
    // 2 allowed, then 10 refused at the narrow limit…
    expect(await attempts([narrow, wide], 12)).toEqual([
      "ok",
      "ok",
      ...Array<"refused">(10).fill("refused"),
    ]);
    // …so the wide one has only counted the 2, and still has 3 left.
    expect(await attempts([wide], 4)).toEqual(["ok", "ok", "ok", "refused"]);
  });

  it("opens again when the window runs out", async () => {
    const limit = fresh({ max: 1, windowMs: 300 });
    expect(await attempts([limit], 2)).toEqual(["ok", "refused"]);
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(await attempts([limit], 1)).toEqual(["ok"]);
  });

  it("keeps no address in the keys", async () => {
    await takeAttempt(deviceLimit("test-device", "203.0.113.7", 5, 60_000), message);
    const keys: string[] = [];
    const redis = getRedis()!;
    const nodes = "nodes" in redis ? redis.nodes("master") : [redis];
    for (const node of nodes) {
      // oxlint-disable-next-line no-await-in-loop
      keys.push(...(await node.keys("service-finder:limit:test-device:*")));
    }
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.some((key) => key.includes("203.0.113.7"))).toBe(false);
  });

  it("authenticator codes: five wrong per account, whichever challenge they came through", async () => {
    const userId = crypto.randomUUID();
    expect(await attempts(mfaCodeLimits("bo", userId), 6)).toEqual([
      ...Array<"ok">(5).fill("ok"),
      "refused",
    ]);
    // A different person isn't affected.
    expect(await attempts(mfaCodeLimits("bo", crypto.randomUUID()), 1)).toEqual(["ok"]);
  });

  it("a device limit counts one device across everything under its name", async () => {
    const ip = `198.51.100.${Math.floor(Math.random() * 200) + 1}`;
    expect(await attempts(deviceLimit("test-codes", ip, 20, 60_000), 21)).toEqual([
      ...Array<"ok">(20).fill("ok"),
      "refused",
    ]);
    // An unknown address is never counted, so it never throws.
    expect(deviceLimit("test-codes", undefined, 1, 60_000)).toEqual([]);
  });
});
