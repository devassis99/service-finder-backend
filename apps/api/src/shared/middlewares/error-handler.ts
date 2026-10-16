import type { NextFunction, Request, Response } from "express";
import Stripe from "stripe";
import { ZodError } from "zod";
import { env } from "../../config/env";
import {
  AuthError,
  ForbiddenError,
  ConflictError,
  NotFoundError as AuthNotFoundError,
} from "../../modules/auth/auth.service";
import { NotFoundError as BillingNotFoundError } from "../../modules/products/products.service";
import { TooManyAttemptsError } from "../rate-limit";

/**
 * Central error handler — must be registered last, after every route.
 * Express 5 auto-forwards rejected promises from async route handlers
 * and middleware here, so controllers/services just `throw` instead of
 * every call site needing its own try/catch.
 *
 * Each module defines its own error classes rather than sharing one set
 * (see auth.service.ts) — every module's classes are checked here,
 * aliased so they don't collide across module boundaries. A new module
 * adds its classes to the import list above and to the matching
 * `instanceof` group below; one it forgets falls through to a 500, which
 * is loud enough to be found in the first test that throws it.
 *
 * users and roles throw the auth module's classes directly (see
 * modules/auth/index.ts), so they need no entries of their own. The
 * three billing modules (products, prices, payment-links) share one
 * NotFoundError, products', and use auth's ConflictError for a 409.
 */
// Express identifies error-handling middleware purely by arity (4 params) —
// _next must stay in the signature even though unused.
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  /**
   * No error answer here is worth keeping.
   *
   * 404 and 410 are cacheable *by default* in HTTP — no header needed,
   * and a browser will heuristically keep them. Both say something that
   * changes, and a browser that cached "not found" keeps showing it off
   * its own disk long after the thing exists, with nothing we can do to
   * bust it.
   *
   * Set for every error, not just those two: the rest are answers about
   * one caller's request — a token, a permission, a conflict — and a
   * shared cache has no business holding any of them.
   */
  res.setHeader("Cache-Control", "no-store");

  if (err instanceof AuthError) {
    return res.status(401).json({ error: err.message });
  }
  if (err instanceof ForbiddenError) {
    return res.status(403).json({ error: err.message });
  }
  if (err instanceof ConflictError) {
    return res.status(409).json({ error: err.message });
  }
  if (err instanceof AuthNotFoundError || err instanceof BillingNotFoundError) {
    return res.status(404).json({ error: err.message });
  }
  // Sign-in and code limits (shared/rate-limit.ts). Retry-After as well as
  // the body, so anything that speaks HTTP backs off without reading our
  // JSON; `code` so a client can tell "slow down" from any other 429.
  if (err instanceof TooManyAttemptsError) {
    res.setHeader("Retry-After", String(err.retryAfterSeconds));
    return res.status(429).json({
      error: err.message,
      code: "TOO_MANY_ATTEMPTS",
      retryAfterSeconds: err.retryAfterSeconds,
    });
  }
  /**
   * Stripe said no. Every billing write calls Stripe before touching our
   * own tables, so this is where a Plans-page action fails most often.
   *
   * An invalid request is the admin's input as Stripe judged it — an
   * amount under the minimum, a currency the account can't charge in —
   * and Stripe's own message is the useful answer, so it's passed on as
   * a 400. Anything else (a rejected key, Stripe down, a rate limit) is
   * ours to fix, not theirs: a 502 that says Stripe failed without
   * saying why, and the detail in the server log.
   */
  if (err instanceof Stripe.errors.StripeError) {
    console.error(err);
    if (err instanceof Stripe.errors.StripeInvalidRequestError) {
      return res.status(400).json({ error: `Stripe: ${err.message}`, code: "STRIPE_REJECTED" });
    }
    return res.status(502).json({
      error: "Stripe couldn't complete this request — try again shortly.",
      code: "STRIPE_UNAVAILABLE",
    });
  }
  /**
   * A schema failure names the fields and the half of the request they
   * were in. A bare "Invalid request body" on a GET sends whoever reads
   * it looking for a body the request never had; `details` carries the
   * full breakdown, and the line a human actually reads says where to
   * look.
   */
  if (err instanceof ZodError) {
    const flat = err.flatten();
    const fields = Object.keys(flat.fieldErrors);
    const where = req.method === "GET" || req.method === "DELETE" ? "request" : "request body";
    return res.status(400).json({
      error: fields.length > 0 ? `Invalid ${where}: ${fields.join(", ")}` : `Invalid ${where}`,
      details: flat,
    });
  }

  console.error(err);
  // Outside production the cause travels back to the caller as well as to
  // the server console. An unhandled 500 is almost always seen first in
  // the browser's network tab, and "Internal server error" alone means a
  // round trip to whichever terminal happens to be running the API before
  // anyone can even name the bug. `detail` is stripped in production, so
  // stack traces never reach a real client.
  if (env.NODE_ENV !== "production") {
    return res.status(500).json({
      error: "Internal server error",
      detail: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
      stack: err instanceof Error ? err.stack?.split("\n").slice(0, 6) : undefined,
    });
  }
  return res.status(500).json({ error: "Internal server error" });
}
