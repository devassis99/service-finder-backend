/**
 * fetch for a send to an outside provider (Resend, an SMS gateway) that rides out
 * the provider's own rate limit.
 *
 * Resend allows 10 requests a second per team and answers 429 above it;
 * SMS gateways answer 429 too. Without this, a burst — a handful of
 * confirmations landing in the same second — turns into failed requests
 * for the people at the end of it.
 *
 * Retries on 429 only. A 429 is the provider refusing the request before
 * doing anything, so sending again can't deliver twice; a 5xx or a
 * dropped connection might have sent already, and is left to fail. Waits
 * as long as Retry-After asks, but never longer than `maxWaitMs` — this
 * runs while somebody waits for a response, and a provider asking for
 * thirty seconds is better answered with an error now.
 */
export interface RetryOptions {
  /** Further tries after the first. */
  retries?: number;
  /** Longest single wait, in ms. */
  maxWaitMs?: number;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Retry-After as ms: either delta-seconds or an HTTP date. null if absent or unreadable. */
export function retryAfterMs(header: string | null, now = Date.now()): number | null {
  if (header === null || header.trim() === "") return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const at = Date.parse(header);
  return Number.isNaN(at) ? null : Math.max(0, at - now);
}

export async function fetchWithRateLimitRetry(
  url: string,
  init: RequestInit,
  { retries = 2, maxWaitMs = 2000 }: RetryOptions = {},
): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    // oxlint-disable-next-line no-await-in-loop -- each try depends on the last one's answer
    const response = await fetch(url, init);
    if (response.status !== 429 || attempt >= retries) return response;

    const asked = retryAfterMs(response.headers.get("retry-after"));
    const wait = asked ?? 250 * 2 ** attempt;
    if (wait > maxWaitMs) return response;
    // Drain the refused response so its socket can be reused.
    // oxlint-disable-next-line no-await-in-loop
    await response.arrayBuffer().catch(() => undefined);
    // oxlint-disable-next-line no-await-in-loop
    await sleep(wait);
  }
}
