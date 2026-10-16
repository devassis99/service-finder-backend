import Stripe from "stripe";
import { env } from "../config/env";

/**
 * One Stripe SDK client, created once and reused — never instantiate
 * per request. apiVersion is intentionally left unset so the SDK uses
 * its own pinned default rather than a hardcoded string here going
 * stale as Stripe's API evolves.
 *
 * Lives in shared/ rather than any one billing module — products,
 * prices and payment-links (three separate modules over one group of
 * tables; see packages/db/src/schema/billing-*.ts) all need this same
 * client, so no single one of them should own it. Same rationale as
 * shared/middlewares.
 *
 * Every service test mocks this module (vi.mock("../../shared/stripe")),
 * so `pnpm test` never reaches Stripe.
 */
export const stripe = new Stripe(env.STRIPE_SECRET_KEY);
