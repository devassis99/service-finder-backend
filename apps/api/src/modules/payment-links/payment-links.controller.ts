import type { Request, Response } from "express";
import * as paymentLinksService from "./payment-links.service";
import {
  createPaymentLinkSchema,
  priceIdParamsSchema,
  signupLinkTokenParamsSchema,
} from "./payment-links.validators";
import { AuthError } from "../auth";

/** "Create Payment Link" dialog on the Plans page — custom, possibly-multi-cycle links. */
export async function createPaymentLinks(req: Request, res: Response) {
  if (!req.boUser) {
    throw new AuthError("Missing bearer token");
  }
  const input = createPaymentLinkSchema.parse(req.body);
  const paymentLinks = await paymentLinksService.createPaymentLinks({
    productId: input.productId,
    billingIntervals: input.billingIntervals,
    seatOverride: input.seatOverride,
    trialDaysOverride: input.trialDaysOverride,
    discount:
      input.discountType !== undefined && input.discountValue !== undefined
        ? { type: input.discountType, value: input.discountValue }
        : undefined,
    expiresInDays: input.expiresInDays,
    createdByUserId: req.boUser.id,
  });
  res.status(201).json({ paymentLinks });
}

/** The per-row "Copy" action in the Plans table — plain, no-override, reusable signup link for one price. */
export async function getOrCreateDefaultPaymentLink(req: Request, res: Response) {
  const { priceId } = priceIdParamsSchema.parse(req.params);
  const paymentLink = await paymentLinksService.getOrCreateDefaultPaymentLink(priceId);
  res.json({ paymentLink });
}

/** Public — the tenant app's /join/<token> page, before the visitor has an account. */
export async function getSignupLink(req: Request, res: Response) {
  const { token } = signupLinkTokenParamsSchema.parse(req.params);
  const signupLink = await paymentLinksService.getPublicSignupLink(token);
  res.json({ signupLink });
}
