import { Router } from "express";
import * as usersController from "./users.controller";
import { requireAuth, requirePermission } from "../auth";

export const usersRouter = Router();

// Every route here requires a logged-in session (requireAuth) *and* the
// role-specific permission (requirePermission) — this is what makes the
// "block the tab, block the API too" requirement real: a role without
// users.view gets a 403 calling these endpoints directly, not just a
// hidden nav item.
usersRouter.get("/", requireAuth, requirePermission("users.view"), usersController.listUsers);
usersRouter.post("/", requireAuth, requirePermission("users.manage"), usersController.inviteUser);
usersRouter.patch(
  "/:userId/role",
  requireAuth,
  requirePermission("users.manage"),
  usersController.updateUserRole,
);
usersRouter.patch(
  "/:userId/active",
  requireAuth,
  requirePermission("users.manage"),
  usersController.setUserActive,
);
