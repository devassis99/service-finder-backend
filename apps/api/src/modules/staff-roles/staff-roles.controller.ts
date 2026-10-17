import type { Request, Response } from "express";
import * as staffRolesService from "./staff-roles.service";
import {
  roleIdParamsSchema,
  createRoleSchema,
  updateRoleSchema,
  updateRolePermissionsSchema,
} from "./staff-roles.validators";

/** requireAccountAuth (mounted on the parent staffRouter) guarantees req.staffUser is set below. */

function caller(req: Request): staffRolesService.Caller {
  return {
    id: req.staffUser!.id,
    accountId: req.staffUser!.accountId,
    roleId: req.staffUser!.roleId,
  };
}

export async function listRoles(req: Request, res: Response) {
  const roles = await staffRolesService.listRoles(req.staffUser!.accountId);
  res.json({ roles });
}

export async function listPermissionsCatalog(_req: Request, res: Response) {
  const permissions = await staffRolesService.listPermissionsCatalog();
  res.json({ permissions });
}

export async function createRole(req: Request, res: Response) {
  const input = createRoleSchema.parse(req.body);
  const role = await staffRolesService.createRole(caller(req), input);
  res.status(201).json({ role });
}

export async function updateRole(req: Request, res: Response) {
  const { roleId } = roleIdParamsSchema.parse(req.params);
  const patch = updateRoleSchema.parse(req.body);
  const role = await staffRolesService.updateRole(caller(req), roleId, patch);
  res.json({ role });
}

export async function updateRolePermissions(req: Request, res: Response) {
  const { roleId } = roleIdParamsSchema.parse(req.params);
  const { permissionKeys } = updateRolePermissionsSchema.parse(req.body);
  const role = await staffRolesService.updateRolePermissions(caller(req), roleId, permissionKeys);
  res.json({ role });
}

export async function deleteRole(req: Request, res: Response) {
  const { roleId } = roleIdParamsSchema.parse(req.params);
  await staffRolesService.deleteRole(caller(req), roleId);
  res.status(204).send();
}
