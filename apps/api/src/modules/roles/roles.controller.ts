import type { Request, Response } from "express";
import * as rolesService from "./roles.service";
import {
  createRoleSchema,
  updateRolePermissionsSchema,
  roleIdParamsSchema,
} from "./roles.validators";

export async function listRoles(_req: Request, res: Response) {
  const roles = await rolesService.listRoles();
  res.json({ roles });
}

export async function listPermissionsCatalog(_req: Request, res: Response) {
  const permissions = await rolesService.listPermissionsCatalog();
  res.json({ permissions });
}

export async function createRole(req: Request, res: Response) {
  const input = createRoleSchema.parse(req.body);
  const role = await rolesService.createRole(input);
  res.status(201).json({ role });
}

export async function updateRolePermissions(req: Request, res: Response) {
  const { roleId } = roleIdParamsSchema.parse(req.params);
  const { permissionKeys } = updateRolePermissionsSchema.parse(req.body);
  const role = await rolesService.updateRolePermissions(roleId, permissionKeys);
  res.json({ role });
}

export async function deleteRole(req: Request, res: Response) {
  const { roleId } = roleIdParamsSchema.parse(req.params);
  await rolesService.deleteRole(roleId);
  res.status(204).send();
}
