import type { Request, Response } from "express";
import * as productsService from "./products.service";
import { createProductSchema, productIdParamsSchema } from "./products.validators";

/** Public — the self-signup pricing page renders straight from this, no auth required. */
export async function listCatalog(_req: Request, res: Response) {
  const products = await productsService.listCatalog();
  res.json({ products });
}

/** Admin — same shape as listCatalog, but includes archived products/prices too. Used by the back office's Plans page. */
export async function listAdminCatalog(_req: Request, res: Response) {
  const products = await productsService.listAdminCatalog();
  res.json({ products });
}

export async function createProduct(req: Request, res: Response) {
  const input = createProductSchema.parse(req.body);
  const product = await productsService.createProduct(input);
  res.status(201).json({ product });
}

export async function archiveProduct(req: Request, res: Response) {
  const { productId } = productIdParamsSchema.parse(req.params);
  const product = await productsService.archiveProduct(productId);
  res.json({ product });
}
