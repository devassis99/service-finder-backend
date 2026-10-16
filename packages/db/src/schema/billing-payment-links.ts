import { uuid, varchar, integer, boolean, timestamp, text } from "drizzle-orm/pg-core";
import { serviceFinderSchema } from "./_schema";
import { billingProducts } from "./billing-products";
import { billingPrices } from "./billing-prices";
import { timestamps } from "./_helpers";

export const paymentLinkDiscountType = serviceFinderSchema.enum("payment_link_discount_type", [
  "percent",
  "amount",
]);
export type PaymentLinkDiscountType = (typeof paymentLinkDiscountType.enumValues)[number];

/**
 * One row per link the Plans page hands out. Two kinds share this table:
 *
 * - **Signup links** (`token` set, `stripePaymentLinkId` null) — the
 *   per-price "Copy" action. The URL is the tenant app's own
 *   `/join/<token>` (TENANT_APP_URL), meant to run self-signup with the
 *   plan already decided and then go straight to a Stripe Checkout
 *   Session for this row's price — so an account actually gets created
 *   at the end, unlike a bare Stripe Payment Link, which takes the money
 *   and leaves nobody to sign in.
 * - **Stripe Payment Links** (`stripePaymentLinkId` set, `token` null) —
 *   the "Create Payment Link" dialog's custom, one-off links with seat/
 *   trial/discount overrides.
 *
 * Like billingPrices, rows are treated as immutable once created:
 * changing terms always means generating a new link.
 */
export const billingPaymentLinks = serviceFinderSchema.table("billing_payment_links", {
  id: uuid().primaryKey().defaultRandom(),
  productId: uuid("product_id")
    .notNull()
    .references(() => billingProducts.id, { onDelete: "cascade" }),
  priceId: uuid("price_id")
    .notNull()
    .references(() => billingPrices.id, { onDelete: "cascade" }),
  // Null for a signup link — there's no Stripe object until a visitor
  // reaches checkout, and then it's a Checkout Session, not a link.
  stripePaymentLinkId: varchar("stripe_payment_link_id", { length: 255 }).unique(),
  // The public half of a signup link's URL (`/join/<token>`). Random and
  // unguessable rather than the row id, so the set of live links can't be
  // enumerated. Null for a Stripe Payment Link.
  token: varchar({ length: 64 }).unique(),
  url: text().notNull(),
  // True for the single plain signup link a price row's "Copy" action
  // lazily creates-or-reuses (no overrides). Custom links from the
  // "Create Payment Link" dialog are always false, even if they happen to
  // carry no overrides either — see payment-links.service.ts's
  // getOrCreateDefaultPaymentLink.
  isDefault: boolean("is_default").notNull().default(false),
  // Null means "no override" (plan default applies) for both of these —
  // same convention as billingPrices.trialDaysOverride. Note seatOverride
  // is NOT sent to Stripe as a line-item quantity (that would multiply
  // the charged amount); it's metadata only, for a human or a future
  // account-provisioning webhook to read. See payment-links.service.ts.
  seatOverride: integer("seat_override"),
  trialDaysOverride: integer("trial_days_override"),
  discountType: paymentLinkDiscountType("discount_type"),
  // Percent (0-100) when discountType is "percent", minor units (cents)
  // when "amount" — mirrors billingPrices.unitAmount's convention.
  discountValue: integer("discount_value"),
  stripeCouponId: varchar("stripe_coupon_id", { length: 255 }),
  // Stripe's Payment Links API has no field to attach a coupon directly
  // at creation (only Checkout Sessions do) — the real mechanism is
  // allow_promotion_codes plus a customer-facing Promotion Code the
  // buyer types in at checkout. Null unless discountType is set. See
  // payment-links.service.ts's createPaymentLinks.
  stripePromotionCode: varchar("stripe_promotion_code", { length: 255 }),
  // Enforced for signup links (resolveSignupLink refuses an expired
  // one), but record-keeping only for Stripe Payment Links: their API has
  // no native expires_at, and nothing deactivates the Stripe object once
  // this passes (no scheduled job wired up yet). Don't tell an admin a
  // Payment Link will "stop working on its own" based on this field.
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  isActive: boolean("is_active").notNull().default(true),
  // No FK to bo_users — keeps billing decoupled from auth's table graph.
  // Purely informational: which back-office user generated this link.
  createdByUserId: uuid("created_by_user_id"),
  ...timestamps,
});

export type BillingPaymentLink = typeof billingPaymentLinks.$inferSelect;
export type NewBillingPaymentLink = typeof billingPaymentLinks.$inferInsert;
