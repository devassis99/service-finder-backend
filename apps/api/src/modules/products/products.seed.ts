import { and, eq } from "drizzle-orm";
import * as productsService from "./products.service";
import * as pricesService from "../prices/prices.service";
import { db, closeDb } from "../../db";
import { env } from "../../config/env";
import { billingProducts, billingPrices, type BillingInterval } from "@service-finder/db/schema";

/**
 * Idempotent — safe to re-run, same as auth.seed.ts. Seeds a starting
 * set of plans as real Stripe Products/Prices, through
 * products.service.ts / prices.service.ts, so this exercises the exact
 * same code paths the Plans page uses — no separate Stripe-calling logic
 * to keep in sync.
 *
 * PLACEHOLDERS. Service Finder's real tiers and prices aren't decided
 * yet, so the three below are a reasonable shape to start from, not a
 * pricing decision: edit CATALOG before running this against an account
 * that matters. Re-running only creates what doesn't exist yet (matched
 * by `key`, and by an active price per cadence) — it never edits or
 * duplicates anything already seeded. To change a seeded price, add the
 * new one from the Plans page ("+ Price"); that archives the old one.
 *
 * Every cadence's price is a flat multiple of the monthly amount, with
 * Annual at 20% off. `limits.seats` is what the Plans page's SEATS
 * column shows; no `seats` key means unlimited.
 */
const CATALOG = [
  {
    key: "starter",
    name: "Starter",
    description: "For a single provider getting started.",
    features: ["1 seat", "Listed in search", "Job requests by email"],
    limits: { seats: 1 },
    trialDays: 14,
    sortOrder: 0,
    monthlyAmount: 1900,
  },
  {
    key: "pro",
    name: "Pro",
    description: "For a small team taking regular work.",
    features: ["Up to 5 seats", "Priority placement", "Team inbox"],
    limits: { seats: 5 },
    trialDays: 0,
    sortOrder: 1,
    monthlyAmount: 4900,
  },
  {
    key: "business",
    name: "Business",
    description: "For established businesses with several crews.",
    features: ["Unlimited seats", "Multiple service areas", "Priority support"],
    limits: {},
    trialDays: 0,
    sortOrder: 2,
    monthlyAmount: 9900,
  },
] as const;

// How each cadence's price relates to the monthly amount: Annual gets
// 20% off, Quarterly and Bi-Annual are flat multiples.
const INTERVAL_MULTIPLIERS: Record<BillingInterval, number> = {
  month: 1,
  quarter: 3,
  half_year: 6,
  year: 12 * 0.8,
};

// Every await below is intentionally sequential, not parallelized —
// this is a one-off seed script, not a hot path. Sequential execution
// keeps the console output in a readable, per-plan order and makes it
// obvious which plan failed if something goes wrong.
async function main() {
  const mode = env.STRIPE_SECRET_KEY.startsWith("sk_live_") ? "LIVE" : "test";
  console.log(`Seeding plans into Stripe (${mode} mode)`);

  for (const plan of CATALOG) {
    // oxlint-disable-next-line no-await-in-loop
    let [product] = await db
      .select()
      .from(billingProducts)
      .where(eq(billingProducts.key, plan.key));

    if (!product) {
      // oxlint-disable-next-line no-await-in-loop
      product = await productsService.createProduct({
        key: plan.key,
        name: plan.name,
        description: plan.description,
        features: [...plan.features],
        limits: { ...plan.limits },
        trialDays: plan.trialDays,
        sortOrder: plan.sortOrder,
      });
      console.log(`Created product "${plan.name}" (${product.stripeProductId})`);
    } else {
      console.log(`Product "${plan.name}" already exists (${product.stripeProductId})`);
    }

    if (!product.isActive) {
      console.log(`  "${plan.name}" is archived — leaving its prices alone`);
      continue;
    }

    for (const interval of ["month", "quarter", "half_year", "year"] as const) {
      // oxlint-disable-next-line no-await-in-loop
      const [existingPrice] = await db
        .select()
        .from(billingPrices)
        .where(
          and(
            eq(billingPrices.productId, product.id),
            eq(billingPrices.billingInterval, interval),
            eq(billingPrices.isActive, true),
          ),
        );

      if (existingPrice) {
        console.log(`  ${interval} price already exists for "${plan.name}"`);
        continue;
      }

      const unitAmount = Math.round(plan.monthlyAmount * INTERVAL_MULTIPLIERS[interval]);
      // oxlint-disable-next-line no-await-in-loop
      const price = await pricesService.createPrice(product.id, {
        billingInterval: interval,
        unitAmount,
      });
      console.log(
        `  Created ${interval} price for "${plan.name}": $${(unitAmount / 100).toFixed(2)} (${price.stripePriceId})`,
      );
    }
  }

  await closeDb();
}

main().catch((err) => {
  console.error("Billing seed failed:", err);
  process.exit(1);
});
