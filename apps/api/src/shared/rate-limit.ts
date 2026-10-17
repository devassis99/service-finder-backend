import crypto from "node:crypto";
import { env } from "../config/env";
import { clientHashFor } from "./client-key";
import { CacheUnavailableError, withRedis, type RedisClient } from "./redis";

/**
 * Attempt limits shared by every API task, kept in Valkey.
 *
 * In-process counters would be wrong as soon as two tasks run behind the
 * load balancer — each would see a fraction of the attempts — and
 * Postgres is the thing these limits partly exist to protect. Valkey
 * gives one count across every task, with expiry for free.
 *
 * Each limit is a fixed window that starts with its first attempt
 * (INCR, then PEXPIRE on the first), and the attempt is counted *before*
 * the work it guards. Counting after a failed password check would let a
 * script fire five hundred guesses at once and have every one of them
 * pass the check before the first failure was recorded. Counted first,
 * the eleventh request in a window is refused whatever the timing. A
 * success then takes its own attempt back (or clears the counter), so
 * only failures accumulate.
 *
 * Keys hold a salted hash of what is counted — an email, a device —
 * never the thing itself.
 *
 * Fail-open, deliberately. If Valkey can't answer, sign-in carries on
 * unlimited rather than nobody being able to sign in: these limits slow
 * an attacker down, and an outage of a few minutes doesn't change what
 * a password is worth. Logged once a minute.
 */

export class TooManyAttemptsError extends Error {
  readonly retryAfterSeconds: number;
  constructor(message: string, retryAfterSeconds: number) {
    super(message);
    this.name = "TooManyAttemptsError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export interface AttemptLimit {
  /** What kind of thing is counted, e.g. "bo-mfa". Part of the key. */
  name: string;
  /** Which one — an email, a user id, a device hash. Hashed before it becomes a key. */
  subject: string;
  /** Attempts allowed in the window. The next one is refused. */
  max: number;
  windowMs: number;
  /**
   * On success: forget the counter (true), or just take back the one
   * attempt this was (false, the default). Reset only where a success
   * proves the counted party is genuine — the right password from this
   * device clears this device's count for this account, but says nothing
   * about everyone else trying the same account.
   */
  resetOnSuccess?: boolean;
}

export interface Attempt {
  /** Call once the guarded step succeeded. Never throws. */
  succeeded(): Promise<void>;
}

const NOOP_ATTEMPT: Attempt = { succeeded: async () => {} };

/** KEYS: the counter. ARGV: window ms. Returns { count, ms left in the window }. */
const COUNT_SCRIPT = `
local n = redis.call('INCR', KEYS[1])
if n == 1 or redis.call('PTTL', KEYS[1]) < 0 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
return { n, redis.call('PTTL', KEYS[1]) }
`;

/** KEYS: the counter. Takes one attempt back, never below zero, keeping the window. */
const GIVE_BACK_SCRIPT = `
local n = tonumber(redis.call('GET', KEYS[1]) or '0')
if n > 0 then return redis.call('DECR', KEYS[1]) end
return 0
`;

interface LimitScripts {
  sfCountAttempt(key: string, windowMs: string): Promise<[number, number]>;
  sfGiveBackAttempt(key: string): Promise<number>;
}

const prepared = new WeakSet<object>();
function scripts(redis: RedisClient): RedisClient & LimitScripts {
  if (!prepared.has(redis)) {
    redis.defineCommand("sfCountAttempt", { numberOfKeys: 1, lua: COUNT_SCRIPT });
    redis.defineCommand("sfGiveBackAttempt", { numberOfKeys: 1, lua: GIVE_BACK_SCRIPT });
    prepared.add(redis);
  }
  return redis as RedisClient & LimitScripts;
}

export function limitKey(limit: Pick<AttemptLimit, "name" | "subject">): string {
  const digest = crypto
    .createHash("sha256")
    .update(`${env.JWT_SECRET}:${limit.name}:${limit.subject}`)
    .digest("hex");
  return `service-finder:limit:${limit.name}:${digest}`;
}

let lastWarned = 0;
function warnUnavailable(error: unknown) {
  if (!(error instanceof CacheUnavailableError)) throw error;
  if (Date.now() - lastWarned < 60_000) return;
  lastWarned = Date.now();
  console.warn("[rate-limit] Valkey unavailable — letting attempts through uncounted");
}

/**
 * Counts one attempt against every limit, and refuses it with
 * TooManyAttemptsError if any of them is now over. A refused attempt is
 * taken back from the limits it was *not* over, so being stopped at the
 * narrowest level (this device, this account) doesn't also run up the
 * wider counters the real owner shares.
 */
export async function takeAttempt(
  limits: AttemptLimit[],
  messageFor: (minutes: number) => string,
): Promise<Attempt> {
  if (limits.length === 0) return NOOP_ATTEMPT;
  const keys = limits.map(limitKey);

  let counted: { count: number; msLeft: number }[];
  try {
    counted = await withRedis(async (client) => {
      const redis = scripts(client);
      // One key per command: these counters live in different slots, and
      // ElastiCache Serverless is cluster-mode only.
      const replies = await Promise.all(
        keys.map((key, i) => redis.sfCountAttempt(key, String(limits[i]!.windowMs))),
      );
      return replies.map(([count, msLeft]) => ({ count: Number(count), msLeft: Number(msLeft) }));
    });
  } catch (error) {
    warnUnavailable(error);
    return NOOP_ATTEMPT;
  }

  const overIndexes = counted.flatMap((c, i) => (c.count > limits[i]!.max ? [i] : []));
  if (overIndexes.length > 0) {
    const others = keys.filter((_, i) => !overIndexes.includes(i));
    if (others.length > 0) {
      await withRedis(async (client) => {
        const redis = scripts(client);
        await Promise.all(others.map((key) => redis.sfGiveBackAttempt(key)));
      }).catch(warnUnavailable);
    }
    const msLeft = Math.max(...overIndexes.map((i) => counted[i]!.msLeft));
    const retryAfterSeconds = Math.max(1, Math.ceil(msLeft / 1000));
    throw new TooManyAttemptsError(
      messageFor(Math.max(1, Math.ceil(retryAfterSeconds / 60))),
      retryAfterSeconds,
    );
  }

  return {
    async succeeded() {
      await withRedis(async (client) => {
        const redis = scripts(client);
        await Promise.all(
          keys.map((key, i) =>
            limits[i]!.resetOnSuccess ? redis.del(key) : redis.sfGiveBackAttempt(key),
          ),
        );
      }).catch((error: unknown) => {
        // A sign-in that worked must not fail over its bookkeeping.
        if (error instanceof CacheUnavailableError) warnUnavailable(error);
        else console.error("[rate-limit] could not record a success", error);
      });
    },
  };
}

// --- The limits themselves --------------------------------------------
//
// Each one is a small function returning AttemptLimit[], named for what it
// guards, so a call site reads as a policy rather than a set of numbers.

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

const minutes = (n: number) => (n === 1 ? "a minute" : `${n} minutes`);

export const signInMessage = (n: number) =>
  `Too many sign-in attempts. Try again in ${minutes(n)}, or reset your password.`;
export const codeMessage = (n: number) => `Too many wrong codes. Try again in ${minutes(n)}.`;
export const deviceMessage = (n: number) =>
  `Too many attempts from this device. Try again in ${minutes(n)}.`;

/**
 * Password sign-in to the business app, three ways at once (iGroom's
 * policy, unchanged):
 *
 * - this account from this device: 10 per 15 minutes — a person who has
 *   forgotten their password gets ten goes, and a success clears it;
 * - this device across accounts: 100 per 15 minutes — one address trying
 *   a list of accounts (an office's shared connection is nowhere near
 *   that);
 * - this account from anywhere: 50 an hour — a slow attack spread over
 *   many addresses. Deliberately loose: it is the one limit someone else
 *   could run up to keep the real owner out.
 */
export function passwordSignInLimits(
  audience: "staff",
  email: string,
  ip: string | undefined,
): AttemptLimit[] {
  const account = email.trim().toLowerCase();
  const device = clientHashFor(ip);
  const limits: AttemptLimit[] = [
    { name: `${audience}-login:account`, subject: account, max: 50, windowMs: HOUR },
  ];
  if (device) {
    limits.unshift({
      name: `${audience}-login:account-device`,
      subject: `${account}|${device}`,
      max: 10,
      windowMs: 15 * MINUTE,
      resetOnSuccess: true,
    });
    limits.push({
      name: `${audience}-login:device`,
      subject: device,
      max: 100,
      windowMs: 15 * MINUTE,
    });
  }
  return limits;
}

/**
 * Authenticator codes after a correct first factor (a Google sign-in for
 * the back office, a password or Google for the business app): 5 wrong
 * per account per 15 minutes, across every challenge token. A code is 6
 * digits; without this, the minutes one challenge token lives were
 * enough for a script to try a meaningful share of them, and signing in
 * again minted another. Per account rather than per token for exactly
 * that reason.
 *
 * `audience` is part of the key, so the same id in two identity systems
 * never shares a counter.
 */
export function mfaCodeLimits(audience: "bo" | "staff", userId: string): AttemptLimit[] {
  return [
    {
      name: `${audience}-mfa`,
      subject: userId,
      max: 5,
      windowMs: 15 * MINUTE,
      resetOnSuccess: true,
    },
  ];
}

/**
 * One device, across everything it asks for under `name`: the building
 * block for anything a caller can trigger without an account — emailed
 * codes, sign-ups, anything that costs money or reputation to send.
 * Empty when the caller's address is unknown, so it never throws for
 * want of an IP.
 */
export function deviceLimit(
  name: string,
  ip: string | undefined,
  max: number,
  windowMs: number,
): AttemptLimit[] {
  const device = clientHashFor(ip);
  return device ? [{ name: `${name}:device`, subject: device, max, windowMs }] : [];
}

/**
 * Creating a business: each sign-up writes an account, its roles and an
 * owner, and needs no account to call. 10 an hour per device — a real
 * owner signs up once.
 */
export function businessSignupLimits(ip: string | undefined): AttemptLimit[] {
  return deviceLimit("business-signup", ip, 10, HOUR);
}

/**
 * Emailed codes (the Security page's password code). Each person is
 * already held to one a minute in Postgres; this holds one device to 20
 * an hour across people, so nobody can mail a list of strangers from our
 * domain through it.
 */
export function emailCodeLimits(ip: string | undefined): AttemptLimit[] {
  return deviceLimit("email-code", ip, 20, HOUR);
}
