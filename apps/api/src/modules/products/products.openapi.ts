import { registry } from "../../shared/openapi/registry";
import { z } from "../../shared/openapi/zod";
import {
  createProductSchema,
  catalogResponseSchema,
  productResponseSchema,
} from "./products.validators";

registry.registerPath({
  method: "get",
  path: "/billing/products",
  tags: ["Billing"],
  summary: "List the active plan catalog",
  description:
    "Public — no auth required. What the self-signup pricing page renders from: active products with their active, self-signup-visible prices nested. Products with no visible prices are omitted.",
  responses: {
    200: {
      description: "Catalog",
      content: { "application/json": { schema: catalogResponseSchema } },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/billing/products/admin",
  tags: ["Billing"],
  summary: "List every product (including archived) for the back office",
  description:
    "Requires plans.view. Same shape as the public catalog, but without the isActive filters: archived products and prices are included too. Used by the back office's Plans page.",
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      description: "Catalog (all)",
      content: { "application/json": { schema: catalogResponseSchema } },
    },
    403: { description: "Missing the plans.view permission" },
  },
});

registry.registerPath({
  method: "post",
  path: "/billing/products",
  tags: ["Billing"],
  summary: "Create a plan (creates a real Stripe Product)",
  description: "Requires plans.manage.",
  security: [{ bearerAuth: [] }],
  request: { body: { content: { "application/json": { schema: createProductSchema } } } },
  responses: {
    201: {
      description: "Created",
      content: { "application/json": { schema: productResponseSchema } },
    },
    403: { description: "Missing the plans.manage permission" },
    409: { description: "A product with this key already exists" },
  },
});

registry.registerPath({
  method: "patch",
  path: "/billing/products/{productId}/archive",
  tags: ["Billing"],
  summary: "Archive a plan (archives the Stripe Product too)",
  description: "Requires plans.manage.",
  security: [{ bearerAuth: [] }],
  request: { params: z.object({ productId: z.string().uuid() }) },
  responses: {
    200: {
      description: "Archived",
      content: { "application/json": { schema: productResponseSchema } },
    },
    403: { description: "Missing the plans.manage permission" },
    404: { description: "Product not found" },
  },
});
