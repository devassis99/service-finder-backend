import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchWithRateLimitRetry, retryAfterMs } from "./provider-fetch";

const reply = (status: number, headers: Record<string, string> = {}) =>
  new Response(status === 200 ? '{"id":"ok"}' : '{"error":"slow down"}', { status, headers });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("retryAfterMs", () => {
  it("reads seconds and HTTP dates, and nothing else", () => {
    expect(retryAfterMs("2")).toBe(2000);
    expect(retryAfterMs("0")).toBe(0);
    const now = Date.parse("2026-10-11T10:00:00Z");
    expect(retryAfterMs("Sun, 11 Oct 2026 10:00:03 GMT", now)).toBe(3000);
    expect(retryAfterMs(null)).toBeNull();
    expect(retryAfterMs("soon")).toBeNull();
  });
});

describe("fetchWithRateLimitRetry", () => {
  it("waits out a 429 and sends again", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(reply(429, { "retry-after": "0" }))
      .mockResolvedValueOnce(reply(200));
    vi.stubGlobal("fetch", fetchMock);
    const response = await fetchWithRateLimitRetry("https://api.example/send", { method: "POST" });
    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("gives up after its retries, handing back the last 429", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => reply(429, { "retry-after": "0" }));
    vi.stubGlobal("fetch", fetchMock);
    const response = await fetchWithRateLimitRetry("https://api.example/send", {}, { retries: 2 });
    expect(response.status).toBe(429);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("doesn't keep somebody waiting when the provider asks for longer than the cap", async () => {
    const fetchMock = vi.fn().mockResolvedValue(reply(429, { "retry-after": "30" }));
    vi.stubGlobal("fetch", fetchMock);
    const started = Date.now();
    const response = await fetchWithRateLimitRetry("https://api.example/send", {});
    expect(response.status).toBe(429);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(Date.now() - started).toBeLessThan(500);
  });

  it("never resends after a 5xx — it may already have been delivered", async () => {
    const fetchMock = vi.fn().mockResolvedValue(reply(503));
    vi.stubGlobal("fetch", fetchMock);
    const response = await fetchWithRateLimitRetry("https://api.example/send", {});
    expect(response.status).toBe(503);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("backs off on its own when a 429 says nothing about when", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(reply(429)).mockResolvedValueOnce(reply(200));
    vi.stubGlobal("fetch", fetchMock);
    const started = Date.now();
    const response = await fetchWithRateLimitRetry("https://api.example/send", {});
    expect(response.status).toBe(200);
    expect(Date.now() - started).toBeGreaterThanOrEqual(240);
  });
});
