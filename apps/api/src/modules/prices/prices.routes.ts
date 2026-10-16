import { Router } from "express";
import * as pricesController from "./prices.controller";
import { requireAuth, requirePermission } from "../auth";

export const pricesRouter = Router();

// Every route here writes, so every one needs plans.manage — reading
// prices happens through products' GET /products/admin, nested.
pricesRouter.post(
  "/products/:productId/prices",
  requireAuth,
  requirePermission("plans.manage"),
  pricesController.createPrice,
);
pricesRouter.patch(
  "/prices/:priceId/archive",
  requireAuth,
  requirePermission("plans.manage"),
  pricesController.archivePrice,
);
pricesRouter.patch(
  "/prices/:priceId/visibility",
  requireAuth,
  requirePermission("plans.manage"),
  pricesController.updateVisibility,
);
