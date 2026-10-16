import { and, eq } from "drizzle-orm";
import type Stripe from "stripe";
import { db } from "../../db";
import { billingProducts, billingPrices, type BillingInterval } from "@service-finder/db/schema";
import { stripe } from "../../shared/stripe";
import { ConflictError } from "../auth";
import { NotFoundError } from "../products";

/** Maps our logical cadence onto Stripe's interval/interval_count shape. */
function toStripeRecurring(interval: BillingInterval): Stripe.PriceCreateParams.Recurring {
  switch (interval) {
    case "month":
      return { interval: "month", interval_count: 1 };
    case "quarter":
      return { interval: "month", interval_count: 3 };
    case "half_year":
      return { interval: "month", interval_count: 6 };
    case "year":
      return { interval: "year", interval_count: 1 };
  }
}

export interface CreatePriceInput {
  billingInterval: BillingInterval;
  unitAmount: number;
  currency?: string;
  trialDaysOverride?: number;
}

/**
 * Creates a new active Price for a product's cadence, replacing whatever
 * was active for that same product+cadence — only one active Price per
 * product+cadence at a time. Existing subscribers on the price being
 * replaced keep it (grandfathered); only new checkouts see the new one.
 *
 * The order matters, and differs from iGroom's on purpose:
 *
 *  1. The Stripe Price is created first. If Stripe refuses it (a bad
 *     amount, a currency the account can't charge in), nothing here has
 *     changed — the cadence's current price is still the active one,
 *     rather than archived with no replacement.
 *  2. Archiving the old row and inserting the new one happen in one
 *     transaction, so the table never shows the cadence with zero or two
 *     active prices.
 *  3. The replaced Price is archived in Stripe as well, so the Dashboard
 *     agrees with the Plans page. Archiving a Stripe Price only stops new
 *     checkouts on it; subscriptions already on it carry on.
 */
export async function createPrice(productId: string, input: CreatePriceInput) {
  const [product] = await db
    .select()
    .from(billingProducts)
    .where(eq(billingProducts.id, productId));
  if (!product) throw new NotFoundError("Product not found");
  if (!product.isActive) {
    throw new ConflictError("Can't add a price to an archived product");
  }

  const currency = (input.currency ?? "usd").toLowerCase();

  const stripePrice = await stripe.prices.create({
    product: product.stripeProductId,
    unit_amount: input.unitAmount,
    currency,
    recurring: toStripeRecurring(input.billingInterval),
  });

  let created: Awaited<ReturnType<typeof insertReplacing>>;
  try {
    created = await insertReplacing(productId, input, currency, stripePrice.id);
  } catch (err) {
    // The row never landed (most likely a concurrent "+ Price" on the
    // same cadence won the active slot) — don't leave a sellable Price
    // in Stripe that nothing here knows about.
    await stripe.prices.update(stripePrice.id, { active: false }).catch(() => {});
    throw err;
  }

  await Promise.all(
    created.replaced.map((old) =>
      stripe.prices.update(old.stripePriceId, { active: false }).catch((err: unknown) => {
        // The new price is already live here; failing the request now
        // would report an error for a change that happened. Log it — the
        // old Price just stays sellable in Stripe until archived by hand.
        console.error(`Could not archive replaced Stripe price ${old.stripePriceId}:`, err);
      }),
    ),
  );

  return created.price;
}

async function insertReplacing(
  productId: string,
  input: CreatePriceInput,
  currency: string,
  stripePriceId: string,
) {
  return db.transaction(async (tx) => {
    // The replaced price's self-signup visibility carries over, so
    // re-pricing a cadence that was hidden doesn't quietly publish it.
    const replaced = await tx
      .update(billingPrices)
      .set({ isActive: false })
      .where(
        and(
          eq(billingPrices.productId, productId),
          eq(billingPrices.billingInterval, input.billingInterval),
          eq(billingPrices.isActive, true),
        ),
      )
      .returning({
        stripePriceId: billingPrices.stripePriceId,
        showOnSignup: billingPrices.showOnSignup,
      });

    const [price] = await tx
      .insert(billingPrices)
      .values({
        productId,
        stripePriceId,
        billingInterval: input.billingInterval,
        unitAmount: input.unitAmount,
        currency,
        trialDaysOverride: input.trialDaysOverride,
        showOnSignup: replaced[0]?.showOnSignup ?? true,
      })
      .returning();

    return { price, replaced };
  });
}

export async function archivePrice(priceId: string) {
  const [price] = await db.select().from(billingPrices).where(eq(billingPrices.id, priceId));
  if (!price) throw new NotFoundError("Price not found");

  await stripe.prices.update(price.stripePriceId, { active: false });

  const [updated] = await db
    .update(billingPrices)
    .set({ isActive: false })
    .where(eq(billingPrices.id, priceId))
    .returning();

  return updated;
}

/**
 * Toggles one price's visibility on the public self-signup catalog
 * without touching isActive — see billing-prices.ts's showOnSignup doc
 * comment. No Stripe call: Stripe has no concept of this, it's a purely
 * local display flag.
 */
export async function setShowOnSignup(priceId: string, showOnSignup: boolean) {
  const [updated] = await db
    .update(billingPrices)
    .set({ showOnSignup })
    .where(eq(billingPrices.id, priceId))
    .returning();
  if (!updated) throw new NotFoundError("Price not found");
  return updated;
}
