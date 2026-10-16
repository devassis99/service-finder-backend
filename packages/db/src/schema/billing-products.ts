import { uuid, varchar, text, integer, boolean, jsonb } from "drizzle-orm/pg-core";
import { serviceFinderSchema } from "./_schema";
import { timestamps } from "./_helpers";

/**
 * One row per subscription tier (Starter, Pro, Business, ...), mirroring
 * a Stripe Product. `pnpm db:seed:billing` can bootstrap a starting set,
 * but every tier is fully manageable afterwards from the back office's
 * Plans page — seeding is a convenience, not the only way in.
 */
export const billingProducts = serviceFinderSchema.table("billing_products", {
  id: uuid().primaryKey().defaultRandom(),
  // Stable internal identifier — never renamed even if the display name
  // changes, since code may reference it directly (e.g. feature gating).
  key: varchar({ length: 100 }).notNull().unique(),
  stripeProductId: varchar("stripe_product_id", { length: 255 }).notNull().unique(),
  name: varchar({ length: 255 }).notNull(),
  description: text(),
  // Marketing bullet points for the pricing page, e.g.
  // ["Unlimited job requests"]. Display-only, not enforced here.
  features: jsonb().$type<string[]>().notNull().default([]),
  // Plan caps enforced by the app, not by Stripe — e.g. {"seats": 5}, the
  // number the Plans page's SEATS column shows. A missing key means
  // unlimited for that dimension. jsonb instead of fixed columns so a new
  // limit type never needs a migration.
  limits: jsonb().$type<Record<string, number>>().notNull().default({}),
  // Default trial length in days, applied at Checkout/Subscription
  // creation time — never baked into the Stripe Price object itself, so
  // changing it is a config edit, not a new Price. See billingPrices
  // .trialDaysOverride for per-cadence overrides.
  trialDays: integer("trial_days").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  // Self-signup visibility lives per price (billingPrices.showOnSignup),
  // not here — so e.g. Pro Monthly can be on the pricing page while Pro
  // Bi-Annual is payment-link only. A product with no visible active
  // prices simply drops out of the public catalog.
  sortOrder: integer("sort_order").notNull().default(0),
  ...timestamps,
});

export type BillingProduct = typeof billingProducts.$inferSelect;
export type NewBillingProduct = typeof billingProducts.$inferInsert;
