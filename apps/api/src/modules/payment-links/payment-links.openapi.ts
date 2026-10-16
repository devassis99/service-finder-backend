import { registry } from "../../shared/openapi/registry";
import { z } from "../../shared/openapi/zod";
import {
  createPaymentLinkSchema,
  createPaymentLinksResponseSchema,
  defaultPaymentLinkResponseSchema,
  publicSignupLinkResponseSchema,
} from "./payment-links.validators";

registry.registerPath({
  method: "post",
  path: "/billing/payment-links",
  tags: ["Billing"],
  summary: "Create custom Payment Link(s) for a product (creates real Stripe Payment Links)",
  description:
    "Requires plans.manage. One link is created per billing cycle listed — Stripe can't offer several prices for a buyer to pick between within a single link, so requesting several cycles returns several links. Supports a shared discount coupon, a trial-length override, and a seat-count override (the latter is metadata only, not a checkout quantity multiplier).",
  security: [{ bearerAuth: [] }],
  request: { body: { content: { "application/json": { schema: createPaymentLinkSchema } } } },
  responses: {
    201: {
      description: "Created",
      content: { "application/json": { schema: createPaymentLinksResponseSchema } },
    },
    403: { description: "Missing the plans.manage permission" },
    404: { description: "Product not found, or no active price for a requested cycle" },
    409: {
      description:
        "The product is archived, or the selected cycles use mismatched currencies for a fixed-amount discount",
    },
  },
});

registry.registerPath({
  method: "post",
  path: "/billing/prices/{priceId}/payment-link",
  tags: ["Billing"],
  summary: 'Get-or-create the default signup link for a price (the table row\'s "Copy" action)',
  description:
    "Requires plans.manage. Idempotent — reuses the existing default link for this price if one already exists. The URL is a tenant-app signup link (TENANT_APP_URL/join/<token>) that runs self-signup with this price already chosen, not a Stripe Payment Link.",
  security: [{ bearerAuth: [] }],
  request: { params: z.object({ priceId: z.string().uuid() }) },
  responses: {
    200: {
      description: "The default signup link",
      content: { "application/json": { schema: defaultPaymentLinkResponseSchema } },
    },
    403: { description: "Missing the plans.manage permission" },
    404: { description: "Price not found" },
    409: { description: "Price is archived" },
  },
});

registry.registerPath({
  method: "get",
  path: "/billing/signup-links/{token}",
  tags: ["Billing"],
  summary: "Resolve a signup link (public)",
  description:
    "What the tenant app's /join/<token> page renders from: the plan, cadence, price and trial the link sells. 404 for an unknown token, 409 for a link that's switched off, expired, or whose plan is no longer offered.",
  request: { params: z.object({ token: z.string() }) },
  responses: {
    200: {
      description: "The link's plan",
      content: { "application/json": { schema: publicSignupLinkResponseSchema } },
    },
    404: { description: "No such link" },
    409: { description: "Link switched off, expired, or plan no longer offered" },
  },
});
