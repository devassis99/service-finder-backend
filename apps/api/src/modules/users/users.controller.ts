import type { Request, Response } from "express";
import * as usersService from "./users.service";
import { AuthError } from "../auth";
import {
  inviteUserSchema,
  updateUserRoleSchema,
  setUserActiveSchema,
  userIdParamsSchema,
} from "./users.validators";

function requireBoUser(req: Request) {
  if (!req.boUser) throw new AuthError("Missing bearer token");
  return req.boUser;
}

export async function listUsers(_req: Request, res: Response) {
  const users = await usersService.listUsers();
  res.json({ users });
}

export async function inviteUser(req: Request, res: Response) {
  const input = inviteUserSchema.parse(req.body);
  const user = await usersService.inviteUser(input);
  res.status(201).json({ user });
}

export async function updateUserRole(req: Request, res: Response) {
  const boUser = requireBoUser(req);
  const { userId } = userIdParamsSchema.parse(req.params);
  const { roleId } = updateUserRoleSchema.parse(req.body);
  const user = await usersService.updateUserRole(userId, roleId, boUser.id);
  res.json({ user });
}

export async function setUserActive(req: Request, res: Response) {
  const boUser = requireBoUser(req);
  const { userId } = userIdParamsSchema.parse(req.params);
  const { isActive } = setUserActiveSchema.parse(req.body);
  const user = await usersService.setUserActive(userId, isActive, boUser.id);
  res.json({ user });
}
