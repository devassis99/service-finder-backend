import type { Request, Response } from "express";
import type { Caller } from "../staff-roles/staff-roles.service";
import * as staffService from "./staff.service";
import * as inviteService from "./staff-invites.service";
import {
  staffIdParamsSchema,
  inviteStaffSchema,
  updateStaffSchema,
  setStaffActiveSchema,
} from "./staff.validators";

/** requireAccountAuth (mounted for the whole router) guarantees req.staffUser is set below. */

/** Who is asking — what staff-roles.service.ts's assertCovers checks every write against. */
function caller(req: Request): Caller {
  return {
    id: req.staffUser!.id,
    accountId: req.staffUser!.accountId,
    roleId: req.staffUser!.roleId,
  };
}

export async function listStaff(req: Request, res: Response) {
  const staff = await staffService.listStaff(req.staffUser!.accountId);
  res.json({ staff });
}

export async function inviteStaff(req: Request, res: Response) {
  const input = inviteStaffSchema.parse(req.body);
  const { staff, invite } = await staffService.inviteStaff(caller(req), input);
  res.status(201).json({ staff, invite });
}

/** Re-mints and re-sends the setup link for a member who hasn't set themselves up yet. */
export async function resendStaffInvite(req: Request, res: Response) {
  const { staffId } = staffIdParamsSchema.parse(req.params);
  const invite = await inviteService.resendStaffInvite(caller(req), staffId);
  res.json({ invite });
}

/** A setup link to pass on by hand. Same permission as resending — both mint a fresh link and retire the last. */
export async function createStaffInviteLink(req: Request, res: Response) {
  const { staffId } = staffIdParamsSchema.parse(req.params);
  const invite = await inviteService.createStaffInviteLink(caller(req), staffId);
  res.json({ invite });
}

export async function updateStaff(req: Request, res: Response) {
  const { staffId } = staffIdParamsSchema.parse(req.params);
  const patch = updateStaffSchema.parse(req.body);
  const staff = await staffService.updateStaff(caller(req), staffId, patch);
  res.json({ staff });
}

export async function setStaffActive(req: Request, res: Response) {
  const { staffId } = staffIdParamsSchema.parse(req.params);
  const { isActive } = setStaffActiveSchema.parse(req.body);
  const staff = await staffService.setStaffActive(caller(req), staffId, isActive);
  res.json({ staff });
}
