import { Router } from "express";
import * as rolesController from "./roles.controller";
import { requireAuth, requirePermission } from "../auth";

export const rolesRouter = Router();

// GET routes need roles.view; mutations need roles.manage. Same
// "block the tab, block the API" enforcement as users.routes.ts.
rolesRouter.get("/", requireAuth, requirePermission("roles.view"), rolesController.listRoles);
rolesRouter.get(
  "/permissions",
  requireAuth,
  requirePermission("roles.view"),
  rolesController.listPermissionsCatalog,
);
rolesRouter.post("/", requireAuth, requirePermission("roles.manage"), rolesController.createRole);
rolesRouter.patch(
  "/:roleId/permissions",
  requireAuth,
  requirePermission("roles.manage"),
  rolesController.updateRolePermissions,
);
rolesRouter.delete(
  "/:roleId",
  requireAuth,
  requirePermission("roles.manage"),
  rolesController.deleteRole,
);
