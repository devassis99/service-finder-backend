import { z } from "../../shared/openapi/zod";
import { registry } from "../../shared/openapi/registry";

// Route params — plain (unregistered), local duplicate of prices.validators.ts's
// priceIdParamsSchema. Not imported from there: payment-links doesn't
// otherwise depend on the prices module, and this is a one-line shape,
// so a small duplicate here keeps the two modules independent rather
// than wiring up a cross-module import for a single z.object().
export const priceIdParamsSchema = z.object({
  priceId: z.string().uuid(),
});

export const signupLinkTokenParamsSchema = z.object({
  token: z.string().min(1).max(64),
});

export const createPaymentLinkSchema = registry.register(
  "CreatePaymentLinkRequest",
  z
    .object({
      productId: z.string().uuid(),
      billingIntervals: z
        .array(z.enum(["month", "quarter", "half_year", "year"]))
        .min(1)
        .openapi({
          description:
            "One Payment Link is created per cycle listed here — Stripe can't offer several prices for a buyer to pick between within a single link.",
        }),
      seatOverride: z.number().int().positive().optional().openapi({
        description:
          "Metadata only — not sent to Stripe as checkout quantity (that would multiply the charge). For a future account-provisioning step to read.",
      }),
      trialDaysOverride: z.number().int().min(0).optional(),
      discountType: z.enum(["percent", "amount"]).optional(),
      // Whole numbers for both: the column is an integer (cents, or whole
      // percent), and a fractional value would otherwise reach Postgres
      // and come back as a 500 after Stripe had already been called.
      discountValue: z
        .number()
        .int()
        .positive()
        .optional()
        .openapi({ description: 'Whole percent (1–100) for "percent", cents for "amount"' }),
      expiresInDays: z.number().int().positive().nullable().optional(),
    })
    .refine((v) => (v.discountType === undefined) === (v.discountValue === undefined), {
      message: "discountType and discountValue must be provided together",
      path: ["discountValue"],
    })
    .refine((v) => v.discountType !== "percent" || (v.discountValue ?? 0) <= 100, {
      message: "A percentage discount can't exceed 100",
      path: ["discountValue"],
    }),
);

// Response shapes — mirror what payment-links.service.ts actually returns.

export const billingPaymentLinkSchema = registry.register(
  "BillingPaymentLink",
  z.object({
    id: z.string(),
    productId: z.string(),
    priceId: z.string(),
    billingInterval: z.enum(["month", "quarter", "half_year", "year"]),
    url: z.string().openapi({
      description:
        "A tenant-app signup link (/join/<token>) when `token` is set, otherwise a Stripe Payment Link.",
    }),
    token: z.string().nullable(),
    stripePaymentLinkId: z.string().nullable(),
    isDefault: z.boolean(),
    seatOverride: z.number().nullable(),
    trialDaysOverride: z.number().nullable(),
    discountType: z.enum(["percent", "amount"]).nullable(),
    discountValue: z.number().nullable(),
    promotionCode: z.string().nullable().openapi({
      description:
        "Customer-facing code the buyer enters at checkout to redeem the discount — Payment Links can't apply a coupon automatically, only via allow_promotion_codes.",
    }),
    expiresAt: z.string().nullable().openapi({ format: "date-time" }),
    isActive: z.boolean(),
    createdAt: z.string().openapi({ format: "date-time" }),
  }),
);

export const createPaymentLinksResponseSchema = registry.register(
  "CreatePaymentLinksResponse",
  z.object({ paymentLinks: z.array(billingPaymentLinkSchema) }),
);

export const defaultPaymentLinkResponseSchema = registry.register(
  "DefaultPaymentLinkResponse",
  z.object({ paymentLink: billingPaymentLinkSchema }),
);

export const publicSignupLinkResponseSchema = registry.register(
  "PublicSignupLinkResponse",
  z.object({
    signupLink: z.object({
      token: z.string(),
      plan: z.object({
        productId: z.string(),
        key: z.string(),
        name: z.string(),
        description: z.string().nullable(),
        features: z.array(z.string()),
        limits: z.record(z.string(), z.number()),
      }),
      billingCycle: z.enum(["monthly", "quarterly", "biannual", "annual"]),
      unitAmount: z.number().openapi({ description: "Minor units (cents)" }),
      currency: z.string(),
      trialDays: z.number(),
      discountType: z.enum(["percent", "amount"]).nullable(),
      discountValue: z.number().nullable(),
      expiresAt: z.string().nullable().openapi({ format: "date-time" }),
    }),
  }),
);
