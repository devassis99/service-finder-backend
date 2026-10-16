import { z } from "../../shared/openapi/zod";
import { registry } from "../../shared/openapi/registry";

// Request bodies — the exact schemas prices.controller.ts uses to
// validate, registered here so they double as the OpenAPI source too.

export const createPriceSchema = registry.register(
  "CreatePriceRequest",
  z.object({
    billingInterval: z.enum(["month", "quarter", "half_year", "year"]),
    unitAmount: z
      .number()
      .int()
      .positive()
      .openapi({ example: 4900, description: "Amount in minor units (cents)" }),
    currency: z
      .string()
      .regex(/^[A-Za-z]{3}$/, "A three-letter ISO currency code")
      .optional()
      .openapi({ example: "usd", description: 'Defaults to "usd"' }),
    trialDaysOverride: z.number().int().min(0).optional().openapi({
      description: "Overrides the product's trialDays for this cadence. Omit to inherit it.",
    }),
  }),
);

export const updatePriceVisibilitySchema = registry.register(
  "UpdatePriceVisibilityRequest",
  z.object({
    showOnSignup: z.boolean().openapi({
      description:
        "True to show this price on the public self-signup catalog, false to hide it (it can still be sold via a payment link).",
    }),
  }),
);

// Route params — plain (unregistered) schemas, since prices.openapi.ts
// already documents these params inline for Swagger. Here they exist
// purely to turn Express's `string | string[]` req.params typing into a
// real, validated `string` before it reaches prices.service.ts.
export const productIdParamsSchema = z.object({
  productId: z.string().uuid(),
});

export const priceIdParamsSchema = z.object({
  priceId: z.string().uuid(),
});

// Response shape — mirrors what prices.service.ts actually returns.

export const billingPriceSchema = registry.register(
  "BillingPrice",
  z.object({
    id: z.string(),
    productId: z.string(),
    stripePriceId: z.string(),
    billingInterval: z.enum(["month", "quarter", "half_year", "year"]),
    unitAmount: z.number(),
    currency: z.string(),
    trialDaysOverride: z.number().nullable(),
    isActive: z.boolean(),
    showOnSignup: z.boolean(),
    createdAt: z.string().openapi({ format: "date-time" }),
    updatedAt: z.string().openapi({ format: "date-time" }),
  }),
);

export const priceResponseSchema = registry.register(
  "PriceResponse",
  z.object({ price: billingPriceSchema }),
);
