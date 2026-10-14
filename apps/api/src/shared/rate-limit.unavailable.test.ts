import { afterAll, describe, expect, it, vi } from "vitest";

/**
 * With Valkey unreachable, sign-in must carry on — uncounted — rather
 * than nobody being able to sign in. Points the client at a port nothing
 * listens on, so this runs everywhere, no server needed.
 */
vi.mock("../config/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../config/env")>();
  return { env: { ...actual.env, REDIS_URL: "redis://127.0.0.1:1", REDIS_CLUSTER: false } };
});

import { mfaCodeLimits, takeAttempt } from "./rate-limit";
import { closeRedis } from "./redis";

describe("attempt limits with Valkey unreachable", () => {
  afterAll(async () => {
    await closeRedis();
  });

  it("lets the attempt through, quickly, and a success is harmless", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const started = Date.now();
    const attempt = await takeAttempt(mfaCodeLimits("bo", "user_1"), () => "unused");
    await expect(attempt.succeeded()).resolves.toBeUndefined();
    expect(Date.now() - started).toBeLessThan(4000);
    warn.mockRestore();
  });
});
