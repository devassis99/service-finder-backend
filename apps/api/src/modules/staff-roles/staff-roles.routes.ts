import { Router } from "express";
import * as staffRolesController from "./staff-roles.controller";
import { requireAccountPermission } from "../../shared/middlewares/require-account-permission.middleware";

export const staffRolesRouter = Router();

// requireAccountAuth is already applied by the parent staffRouter (see
// staff.routes.ts, which mounts this at "/roles") — only permission
// gating happens here. roles.manage gets a caller through the door;
// what they may then grant is staff-roles.service.ts's assertCovers.

// Registered before "/:roleId" so the literal "permissions" segment
// always wins.
staffRolesRouter.get(
  "/permissions",
  requireAccountPermission("roles.view"),
  staffRolesController.listPermissionsCatalog,
);

staffRolesRouter.get("/", requireAccountPermission("roles.view"), staffRolesController.listRoles);
staffRolesRouter.post(
  "/",
  requireAccountPermission("roles.manage"),
  staffRolesController.createRole,
);
staffRolesRouter.patch(
  "/:roleId",
  requireAccountPermission("roles.manage"),
  staffRolesController.updateRole,
);
staffRolesRouter.patch(
  "/:roleId/permissions",
  requireAccountPermission("roles.manage"),
  staffRolesController.updateRolePermissions,
);
staffRolesRouter.delete(
  "/:roleId",
  requireAccountPermission("roles.manage"),
  staffRolesController.deleteRole,
);
