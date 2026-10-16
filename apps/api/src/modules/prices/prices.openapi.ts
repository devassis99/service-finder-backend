import { registry } from "../../shared/openapi/registry";
import { z } from "../../shared/openapi/zod";
import {
  createPriceSchema,
  priceResponseSchema,
  updatePriceVisibilitySchema,
} from "./prices.validators";

registry.registerPath({
  method: "post",
  path: "/billing/products/{productId}/prices",
  tags: ["Billing"],
  summary: "Add a price for a cadence (creates a real Stripe Price)",
  description:
    "Requires plans.manage. Replaces whatever was active for this product+cadence — only one active price per product+cadence at a time — and archives the replaced one in Stripe too. Existing subscribers on the old price are grandfathered.",
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ productId: z.string().uuid() }),
    body: { content: { "application/json": { schema: createPriceSchema } } },
  },
  responses: {
    201: {
      description: "Created",
      content: { "application/json": { schema: priceResponseSchema } },
    },
    403: { description: "Missing the plans.manage permission" },
    404: { description: "Product not found" },
    409: { description: "The product is archived" },
  },
});

registry.registerPath({
  method: "patch",
  path: "/billing/prices/{priceId}/archive",
  tags: ["Billing"],
  summary: "Archive a price (archives the Stripe Price too)",
  description: "Requires plans.manage. Stripe Prices can't be reactivated or deleted.",
  security: [{ bearerAuth: [] }],
  request: { params: z.object({ priceId: z.string().uuid() }) },
  responses: {
    200: {
      description: "Archived",
      content: { "application/json": { schema: priceResponseSchema } },
    },
    403: { description: "Missing the plans.manage permission" },
    404: { description: "Price not found" },
  },
});

registry.registerPath({
  method: "patch",
  path: "/billing/prices/{priceId}/visibility",
  tags: ["Billing"],
  summary: "Show or hide one price on the public self-signup catalog",
  description:
    "Requires plans.manage. Per price, independent of archiving — e.g. keep a plan's Monthly price on the pricing page while its Bi-Annual price is payment-link only.",
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ priceId: z.string().uuid() }),
    body: { content: { "application/json": { schema: updatePriceVisibilitySchema } } },
  },
  responses: {
    200: {
      description: "Updated",
      content: { "application/json": { schema: priceResponseSchema } },
    },
    403: { description: "Missing the plans.manage permission" },
    404: { description: "Price not found" },
  },
});
