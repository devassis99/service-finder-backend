import { sql } from "drizzle-orm";
import { uuid, varchar, integer, boolean, index, uniqueIndex } from "drizzle-orm/pg-core";
import { serviceFinderSchema } from "./_schema";
import { billingProducts } from "./billing-products";
import { timestamps } from "./_helpers";

/**
 * Our own logical cadence — mapped to Stripe's interval/interval_count
 * in the API's prices.service.ts (month=1mo, quarter=3mo, half_year=6mo,
 * year=1yr), so the API reads "quarter" instead of "month, count 3"
 * everywhere outside that one mapping function.
 */
export const billingInterval = serviceFinderSchema.enum("billing_interval", [
  "month",
  "quarter",
  "half_year",
  "year",
]);
export type BillingInterval = (typeof billingInterval.enumValues)[number];

/**
 * One row per (product, cadence, price-in-effect), mirroring a Stripe
 * Price. Stripe Prices are immutable once created — "changing a price"
 * always means archiving this row (isActive: false) and inserting a new
 * one, never updating unitAmount in place. Archived rows are kept
 * forever: existing subscribers stay on the price they signed up at
 * (grandfathered), only new checkouts see the active one.
 */
export const billingPrices = serviceFinderSchema.table(
  "billing_prices",
  {
    id: uuid().primaryKey().defaultRandom(),
    productId: uuid("product_id")
      .notNull()
      .references(() => billingProducts.id, { onDelete: "cascade" }),
    stripePriceId: varchar("stripe_price_id", { length: 255 }).notNull().unique(),
    billingInterval: billingInterval("billing_interval").notNull(),
    // Minor units (cents), Stripe's own unit.
    unitAmount: integer("unit_amount").notNull(),
    currency: varchar({ length: 3 }).notNull().default("usd"),
    // Overrides billingProducts.trialDays for this specific cadence when
    // set (e.g. no trial on an annual prepay). Null = inherit the
    // product's default.
    trialDaysOverride: integer("trial_days_override"),
    isActive: boolean("is_active").notNull().default(true),
    // Independent of isActive: a price can stay active/sellable (e.g. via
    // an admin-generated payment link — see billingPaymentLinks) while
    // hidden from the public self-signup catalog (GET /billing/products),
    // e.g. a cadence offered only through a sales conversation. Per price,
    // not per product, so each cadence of a plan is toggled on its own.
    // Archiving (isActive: false) hides it everywhere regardless.
    showOnSignup: boolean("show_on_signup").notNull().default(true),
    ...timestamps,
  },
  (table) => [
    index("billing_prices_product_id_idx").on(table.productId),
    // Enforces "at most one active price per product+cadence" at the DB
    // level — a partial index, so it never blocks the many archived
    // historical rows that accumulate for the same product+cadence.
    uniqueIndex("billing_prices_product_interval_active_uq")
      .on(table.productId, table.billingInterval)
      .where(sql`${table.isActive} = true`),
  ],
);

export type BillingPrice = typeof billingPrices.$inferSelect;
export type NewBillingPrice = typeof billingPrices.$inferInsert;
