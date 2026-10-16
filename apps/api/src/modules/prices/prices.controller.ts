import type { Request, Response } from "express";
import * as pricesService from "./prices.service";
import {
  createPriceSchema,
  productIdParamsSchema,
  priceIdParamsSchema,
  updatePriceVisibilitySchema,
} from "./prices.validators";

export async function createPrice(req: Request, res: Response) {
  const { productId } = productIdParamsSchema.parse(req.params);
  const input = createPriceSchema.parse(req.body);
  const price = await pricesService.createPrice(productId, input);
  res.status(201).json({ price });
}

export async function archivePrice(req: Request, res: Response) {
  const { priceId } = priceIdParamsSchema.parse(req.params);
  const price = await pricesService.archivePrice(priceId);
  res.json({ price });
}

/** Toggles whether one price appears on the public self-signup catalog, independent of archiving it. */
export async function updateVisibility(req: Request, res: Response) {
  const { priceId } = priceIdParamsSchema.parse(req.params);
  const { showOnSignup } = updatePriceVisibilitySchema.parse(req.body);
  const price = await pricesService.setShowOnSignup(priceId, showOnSignup);
  res.json({ price });
}
