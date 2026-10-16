import { z } from "../../shared/openapi/zod";
import { registry } from "../../shared/openapi/registry";

// Request bodies — the exact schemas products.controller.ts uses to
// validate, registered here so they double as the OpenAPI source too.

export const createProductSchema = registry.register(
  "CreateProductRequest",
  z.object({
    key: z
      .string()
      .min(1)
      .max(100)
      .regex(/^[a-z0-9]+(?:_[a-z0-9]+)*$/, "Use lowercase letters, digits and single underscores")
      .openapi({
        example: "pro",
        description:
          "Stable internal identifier — never changes even if the display name does. The Plans page derives it from the name.",
      }),
    name: z.string().trim().min(1).max(255).openapi({ example: "Pro" }),
    description: z.string().optional(),
    features: z
      .array(z.string())
      .optional()
      .openapi({ example: ["Unlimited job requests"] }),
    limits: z
      .record(z.string(), z.number().int().positive())
      .optional()
      .openapi({
        example: { seats: 5 },
        description:
          "App-enforced plan caps, not billed by Stripe. `seats` is what the Plans page's SEATS column shows; a missing key means unlimited.",
      }),
    trialDays: z.number().int().min(0).optional().openapi({ example: 14 }),
    sortOrder: z.number().int().optional(),
  }),
);

// Route params — plain (unregistered) schema, since products.openapi.ts
// already documents this param inline for Swagger. Here it exists purely
// to turn Express's `string | string[]` req.params typing into a real,
// validated `string` before it reaches products.service.ts.
export const productIdParamsSchema = z.object({
  productId: z.string().uuid(),
});

// Response shapes — mirror what products.service.ts actually returns.

export const billingProductSchema = registry.register(
  "BillingProduct",
  z.object({
    id: z.string(),
    key: z.string(),
    stripeProductId: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    features: z.array(z.string()),
    limits: z.record(z.string(), z.number()),
    trialDays: z.number(),
    isActive: z.boolean(),
    sortOrder: z.number(),
    createdAt: z.string().openapi({ format: "date-time" }),
    updatedAt: z.string().openapi({ format: "date-time" }),
  }),
);

/**
 * Deliberately NOT imported from prices.validators.ts's billingPriceSchema —
 * doing so would make products depend on prices, and prices.service.ts
 * already imports NotFoundError from products, which would form a
 * circular module dependency. This is a small, local duplicate of the
 * same response shape kept in sync by hand; it is NOT registered with
 * the OpenAPI registry (registering "BillingPrice" twice would make
 * generateOpenApiDocument() throw at boot — app.routes.test.ts guards
 * that) — catalogEntrySchema below embeds it inline instead.
 */
const nestedPriceSchema = z.object({
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
});

export const catalogEntrySchema = registry.register(
  "CatalogEntry",
  billingProductSchema.extend({
    prices: z.array(nestedPriceSchema),
  }),
);

export const catalogResponseSchema = registry.register(
  "CatalogResponse",
  z.object({ products: z.array(catalogEntrySchema) }),
);

export const productResponseSchema = registry.register(
  "ProductResponse",
  z.object({ product: billingProductSchema }),
);
