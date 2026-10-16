import { Router } from "express";
import * as paymentLinksController from "./payment-links.controller";
import { requireAuth, requirePermission } from "../auth";

export const paymentLinksRouter = Router();

// Public — what a "Copy"-ed signup link resolves to, read by the tenant
// app's /join page before the visitor has any account. The token is the
// only thing it accepts and the response carries nothing internal.
paymentLinksRouter.get("/signup-links/:token", paymentLinksController.getSignupLink);

paymentLinksRouter.post(
  "/payment-links",
  requireAuth,
  requirePermission("plans.manage"),
  paymentLinksController.createPaymentLinks,
);
paymentLinksRouter.post(
  "/prices/:priceId/payment-link",
  requireAuth,
  requirePermission("plans.manage"),
  paymentLinksController.getOrCreateDefaultPaymentLink,
);
