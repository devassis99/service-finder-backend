import crypto from "node:crypto";
import { and, eq, isNotNull } from "drizzle-orm";
import { db } from "../../db";
import {
  billingProducts,
  billingPrices,
  billingPaymentLinks,
  type BillingInterval,
  type BillingPaymentLink,
} from "@service-finder/db/schema";
import { stripe } from "../../shared/stripe";
import { env } from "../../config/env";
import { ConflictError } from "../auth";
import { NotFoundError } from "../products";

/** Where a signup link points: the tenant app's /join route, which hands off to its self-signup funnel. */
function signupLinkUrl(token: string) {
  return `${env.TENANT_APP_URL.replace(/\/$/, "")}/join/${token}`;
}

function toPaymentLinkResult(row: BillingPaymentLink, billingInterval: BillingInterval) {
  const { stripePromotionCode, stripeCouponId: _coupon, createdByUserId: _by, ...rest } = row;
  return {
    ...rest,
    // A signup link's URL is rebuilt from its token on every read rather
    // than trusted from the stored `url`: the stored copy carries
    // whatever TENANT_APP_URL was when the link was minted, and that host
    // changes (a dev server → CloudFront → a custom domain). The token is
    // the link; the host is just where the app lives today.
    url: row.token ? signupLinkUrl(row.token) : row.url,
    billingInterval,
    promotionCode: stripePromotionCode,
  };
}

export interface PaymentLinkDiscountInput {
  type: "percent" | "amount";
  value: number;
}

export interface CreatePaymentLinksInput {
  productId: string;
  /** One link is created per requested cycle — Stripe Payment Links can't offer several prices for a buyer to choose between within a single link, so "several cycles" means several links, not one. */
  billingIntervals: BillingInterval[];
  seatOverride?: number;
  trialDaysOverride?: number;
  discount?: PaymentLinkDiscountInput;
  /** Days until this link should stop being offered; null/undefined = never. See billingPaymentLinks.expiresAt's doc comment — Stripe doesn't enforce it. */
  expiresInDays?: number | null;
  createdByUserId?: string;
}

/**
 * Creates a Stripe Coupon plus a customer-facing Promotion Code for it,
 * shared across every link in a single batch — so e.g. "20% off, Monthly
 * + Quarterly" applies the identical discount to both rather than
 * minting a functionally-duplicate coupon per link. duration: "forever"
 * — these are negotiated recurring-subscription deals, meant to apply to
 * every renewal, not just the first invoice.
 *
 * Payment Links have no field to attach a coupon directly at creation
 * (unlike Checkout Sessions) — the only real mechanism is
 * allow_promotion_codes plus a Promotion Code the buyer types in at
 * checkout, so that's what this wires up. Returns the code string to
 * hand to whoever's sharing the link.
 */
async function createSharedDiscount(discount: PaymentLinkDiscountInput, currency: string) {
  const coupon =
    discount.type === "percent"
      ? await stripe.coupons.create({ percent_off: discount.value, duration: "forever" })
      : await stripe.coupons.create({ amount_off: discount.value, currency, duration: "forever" });

  const promotionCode = await stripe.promotionCodes.create({
    promotion: { type: "coupon", coupon: coupon.id },
  });

  return { couponId: coupon.id, promotionCode: promotionCode.code };
}

/**
 * Generates a custom, one-off Payment Link per requested billing cycle
 * for a product — the "Create Payment Link" dialog on the Plans page.
 * Every Stripe call across the requested cycles runs concurrently
 * (independent creates, not a check-then-insert per item, so there's no
 * race to worry about), then all resulting rows are written in a single
 * bulk insert.
 */
export async function createPaymentLinks(input: CreatePaymentLinksInput) {
  const [product] = await db
    .select()
    .from(billingProducts)
    .where(eq(billingProducts.id, input.productId));
  if (!product) throw new NotFoundError("Product not found");
  if (!product.isActive) throw new ConflictError("This product is archived");

  const activePrices = await db
    .select()
    .from(billingPrices)
    .where(and(eq(billingPrices.productId, input.productId), eq(billingPrices.isActive, true)));
  const priceByInterval = new Map(activePrices.map((p) => [p.billingInterval, p]));

  // A cycle listed twice is still one link.
  const targetPrices = [...new Set(input.billingIntervals)].map((interval) => {
    const price = priceByInterval.get(interval);
    if (!price) {
      throw new NotFoundError(`No active price for the "${interval}" cycle on this product`);
    }
    return price;
  });

  let couponId: string | undefined;
  let promotionCode: string | undefined;
  if (input.discount) {
    const currencies = new Set(targetPrices.map((p) => p.currency));
    if (input.discount.type === "amount" && currencies.size > 1) {
      throw new ConflictError(
        "Selected cycles use different currencies — a fixed-amount discount can't apply to all of them at once. Use a percentage discount, or generate separate links per currency.",
      );
    }
    const discount = await createSharedDiscount(input.discount, targetPrices[0].currency);
    couponId = discount.couponId;
    promotionCode = discount.promotionCode;
  }

  const expiresAt = input.expiresInDays
    ? new Date(Date.now() + input.expiresInDays * 86_400_000)
    : null;

  const stripeLinks = await Promise.all(
    targetPrices.map((price) =>
      stripe.paymentLinks.create({
        line_items: [{ price: price.stripePriceId, quantity: 1 }],
        subscription_data:
          input.trialDaysOverride != null
            ? { trial_period_days: input.trialDaysOverride }
            : undefined,
        // Payment Links can't attach a coupon directly (see
        // createSharedDiscount above) — allow_promotion_codes lets the
        // buyer redeem the Promotion Code we generated for it instead.
        allow_promotion_codes: promotionCode ? true : undefined,
        metadata: {
          productId: product.id,
          priceId: price.id,
          ...(input.seatOverride != null ? { seatOverride: String(input.seatOverride) } : {}),
        },
      }),
    ),
  );

  const inserted = await db
    .insert(billingPaymentLinks)
    .values(
      targetPrices.map((price, i) => ({
        productId: product.id,
        priceId: price.id,
        stripePaymentLinkId: stripeLinks[i].id,
        url: stripeLinks[i].url,
        seatOverride: input.seatOverride,
        trialDaysOverride: input.trialDaysOverride,
        discountType: input.discount?.type,
        discountValue: input.discount?.value,
        stripeCouponId: couponId,
        stripePromotionCode: promotionCode,
        expiresAt,
        createdByUserId: input.createdByUserId,
        isDefault: false,
      })),
    )
    .returning();

  return inserted.map((row, i) => toPaymentLinkResult(row, targetPrices[i].billingInterval));
}

/**
 * The plain "Copy" action on a price row in the Plans table — no
 * overrides, one reusable signup link per price. Idempotent: a second
 * click (by the same or another admin) reuses the existing link.
 *
 * This is a tenant-app link (`/join/<token>`), not a Stripe Payment
 * Link: whoever opens it is meant to go through the tenant app's normal
 * self-signup with the plan already decided, and land on a Stripe
 * Checkout Session for exactly this price — ending up with a real
 * account, which a bare Payment Link never creates.
 *
 * The existence check reads the primary: a lagging replica would miss a
 * link minted a moment ago and mint a second one.
 */
export async function getOrCreateDefaultPaymentLink(priceId: string) {
  const [price] = await db.select().from(billingPrices).where(eq(billingPrices.id, priceId));
  if (!price) throw new NotFoundError("Price not found");
  if (!price.isActive) {
    throw new ConflictError("Can't generate a signup link for an archived price");
  }

  const [existing] = await db.$primary
    .select()
    .from(billingPaymentLinks)
    .where(
      and(
        eq(billingPaymentLinks.priceId, priceId),
        eq(billingPaymentLinks.isDefault, true),
        eq(billingPaymentLinks.isActive, true),
        isNotNull(billingPaymentLinks.token),
      ),
    );
  if (existing) {
    return toPaymentLinkResult(existing, price.billingInterval);
  }

  // 16 random bytes → 22 url-safe characters: unguessable, and short
  // enough to survive being pasted into a chat message intact.
  const token = crypto.randomBytes(16).toString("base64url");

  const [row] = await db
    .insert(billingPaymentLinks)
    .values({
      productId: price.productId,
      priceId: price.id,
      token,
      url: signupLinkUrl(token),
      isDefault: true,
    })
    .returning();

  return toPaymentLinkResult(row, price.billingInterval);
}

/** Cadence names as a signup page says them (and as iGroom's tenant app spells them). */
const INTERVAL_TO_BILLING_CYCLE: Record<BillingInterval, string> = {
  month: "monthly",
  quarter: "quarterly",
  half_year: "biannual",
  year: "annual",
};

/**
 * Looks a signup link up by its public token, along with the price and
 * plan it sells. Every check that decides whether the link still *works*
 * lives here, so the tenant app's landing page, the checkout it starts
 * and the account creation after it can't disagree.
 *
 * `afterCheckout` relaxes the "is this still on offer" checks for the
 * one caller that runs once the visitor has already paid (the tenant
 * signup's account creation, when it lands): a link that expired, or a
 * price an admin archived, while someone was on Stripe's page must not
 * strand a customer who has been charged with no account to show for it.
 */
export async function resolveSignupLink(token: string, options: { afterCheckout?: boolean } = {}) {
  const [link] = await db
    .select()
    .from(billingPaymentLinks)
    .where(eq(billingPaymentLinks.token, token));
  if (!link)
    throw new NotFoundError("This signup link doesn't exist — check it was copied in full");

  const [price] = await db.select().from(billingPrices).where(eq(billingPrices.id, link.priceId));
  const [product] = await db
    .select()
    .from(billingProducts)
    .where(eq(billingProducts.id, link.productId));
  if (!price || !product) throw new NotFoundError("This signup link's plan no longer exists");

  if (!options.afterCheckout) {
    if (!link.isActive) throw new ConflictError("This signup link has been switched off");
    if (link.expiresAt && link.expiresAt.getTime() < Date.now()) {
      throw new ConflictError("This signup link has expired");
    }
    if (!price.isActive || !product.isActive) {
      throw new ConflictError("The plan on this signup link is no longer offered");
    }
  }

  // Link override first, then the price's, then the plan's default —
  // the same precedence a Checkout Session applies.
  const trialDays = link.trialDaysOverride ?? price.trialDaysOverride ?? product.trialDays;

  return { link, price, product, trialDays };
}

/**
 * What the tenant app's /join page shows before anyone has typed
 * anything: which plan, at what price and cadence, with what trial.
 * Public — the visitor has no account yet. Deliberately leaves out the
 * internal ids, Stripe ids and who created the link.
 */
export async function getPublicSignupLink(token: string) {
  const { link, price, product, trialDays } = await resolveSignupLink(token);
  return {
    token,
    plan: {
      productId: product.id,
      key: product.key,
      name: product.name,
      description: product.description,
      features: product.features,
      limits: product.limits,
    },
    billingCycle: INTERVAL_TO_BILLING_CYCLE[price.billingInterval],
    unitAmount: price.unitAmount,
    currency: price.currency,
    trialDays,
    discountType: link.discountType,
    discountValue: link.discountValue,
    expiresAt: link.expiresAt,
  };
}
