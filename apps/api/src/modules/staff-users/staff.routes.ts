import { Router } from "express";
import * as staffController from "./staff.controller";
import { staffRolesRouter } from "../staff-roles";
import { requireAccountAuth } from "../../shared/middlewares/require-account-auth.middleware";
import { requireAccountPermission } from "../../shared/middlewares/require-account-permission.middleware";

export const staffRouter = Router();

// Every route here is a signed-in member managing their own business's
// team — nothing in this module is public.
staffRouter.use(requireAccountAuth);

// Registered before "/:staffId" so the literal "roles" segment always
// wins.
staffRouter.use("/roles", staffRolesRouter);

/**
 * Listing needs staff.view; every change needs staff.manage — and then
 * passes staff-roles.service.ts's assertCovers, which keeps a manager
 * from reaching anyone (or handing out any role) beyond their own
 * permissions.
 */
staffRouter.get("/", requireAccountPermission("staff.view"), staffController.listStaff);
staffRouter.post("/", requireAccountPermission("staff.manage"), staffController.inviteStaff);
staffRouter.patch(
  "/:staffId",
  requireAccountPermission("staff.manage"),
  staffController.updateStaff,
);
staffRouter.patch(
  "/:staffId/active",
  requireAccountPermission("staff.manage"),
  staffController.setStaffActive,
);
staffRouter.post(
  "/:staffId/invite/resend",
  requireAccountPermission("staff.manage"),
  staffController.resendStaffInvite,
);
staffRouter.post(
  "/:staffId/invite/link",
  requireAccountPermission("staff.manage"),
  staffController.createStaffInviteLink,
);
