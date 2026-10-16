import { Router } from "express";
import * as productsController from "./products.controller";
import { requireAuth, requirePermission } from "../auth";

export const productsRouter = Router();

// Public — the self-signup pricing page needs this without a session.
productsRouter.get("/products", productsController.listCatalog);

// Back office: plans.view for reads, plans.manage for anything that
// writes. A role without plans.view gets a 403 on GET /products/admin
// even if it guesses the URL — the Plans tab and the API are gated by
// the same key.
//
// Registered before any "/products/:productId" style GET ever lands
// here — "admin" as a literal path segment must keep winning over a
// param route, not get shadowed by it.
productsRouter.get(
  "/products/admin",
  requireAuth,
  requirePermission("plans.view"),
  productsController.listAdminCatalog,
);
productsRouter.post(
  "/products",
  requireAuth,
  requirePermission("plans.manage"),
  productsController.createProduct,
);
productsRouter.patch(
  "/products/:productId/archive",
  requireAuth,
  requirePermission("plans.manage"),
  productsController.archiveProduct,
);
