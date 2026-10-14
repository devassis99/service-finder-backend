import { eq, inArray } from "drizzle-orm";
import { db } from "../../db";
import {
  boRoles,
  boPermissions,
  boRolePermissions,
  boUsers,
  boEndpoints,
  boEndpointPermissions,
} from "@service-finder/db/schema";
import { ConflictError, ForbiddenError, NotFoundError } from "../auth";

export interface RoleView {
  id: string;
  name: string;
  description: string | null;
  permissions: string[];
  userCount: number;
}

/** Every role with its permission keys and how many bo_users currently carry it. */
export async function listRoles(): Promise<RoleView[]> {
  const roles = await db.select().from(boRoles).orderBy(boRoles.name);

  const rolePermissionRows = await db
    .select({ roleId: boRolePermissions.roleId, key: boPermissions.key })
    .from(boRolePermissions)
    .innerJoin(boPermissions, eq(boRolePermissions.permissionId, boPermissions.id));

  const userRoleRows = await db.select({ roleId: boUsers.roleId }).from(boUsers);

  return roles.map((role) => ({
    id: role.id,
    name: role.name,
    description: role.description,
    permissions: rolePermissionRows.filter((row) => row.roleId === role.id).map((row) => row.key),
    userCount: userRoleRows.filter((row) => row.roleId === role.id).length,
  }));
}

/**
 * The full permission catalog, each with the API endpoints it unlocks
 * (via bo_endpoints/bo_endpoint_permissions) — purely descriptive
 * metadata for the Roles & Permissions screen, so an admin building a
 * role can see "granting users.manage also unlocks POST /users" rather
 * than just a bare key. The actual runtime
 * enforcement is requirePermission's direct role -> permission lookup,
 * not a resolution through this table (see
 * src/shared/middlewares/require-permission.middleware.ts).
 */
export async function listPermissionsCatalog() {
  const permissions = await db.select().from(boPermissions).orderBy(boPermissions.key);

  const endpointLinks = await db
    .select({
      permissionId: boEndpointPermissions.permissionId,
      method: boEndpoints.method,
      path: boEndpoints.path,
      name: boEndpoints.name,
    })
    .from(boEndpointPermissions)
    .innerJoin(boEndpoints, eq(boEndpointPermissions.endpointId, boEndpoints.id));

  return permissions.map((permission) => ({
    key: permission.key,
    name: permission.name,
    description: permission.description,
    endpoints: endpointLinks
      .filter((link) => link.permissionId === permission.id)
      .map((link) => ({ method: link.method, path: link.path, name: link.name })),
  }));
}

async function resolvePermissionIds(permissionKeys: string[]) {
  if (permissionKeys.length === 0) return [];
  const permissions = await db
    .select()
    .from(boPermissions)
    .where(inArray(boPermissions.key, permissionKeys));
  if (permissions.length !== new Set(permissionKeys).size) {
    throw new NotFoundError("One or more permission keys don't exist");
  }
  return permissions;
}

export interface CreateRoleInput {
  name: string;
  description?: string;
  permissionKeys: string[];
}

export async function createRole(input: CreateRoleInput): Promise<RoleView> {
  const [existing] = await db.select().from(boRoles).where(eq(boRoles.name, input.name));
  if (existing) throw new ConflictError("A role with this name already exists");

  const permissions = await resolvePermissionIds(input.permissionKeys);

  const [role] = await db
    .insert(boRoles)
    .values({ name: input.name, description: input.description })
    .returning();

  if (permissions.length > 0) {
    await db
      .insert(boRolePermissions)
      .values(permissions.map((permission) => ({ roleId: role.id, permissionId: permission.id })));
  }

  return {
    id: role.id,
    name: role.name,
    description: role.description,
    permissions: permissions.map((p) => p.key),
    userCount: 0,
  };
}

/** Replaces a role's entire permission set (not a diff/patch) with the given keys. */
export async function updateRolePermissions(
  roleId: string,
  permissionKeys: string[],
): Promise<RoleView> {
  const [role] = await db.select().from(boRoles).where(eq(boRoles.id, roleId));
  if (!role) throw new NotFoundError("Role not found");

  const permissions = await resolvePermissionIds(permissionKeys);

  await db.delete(boRolePermissions).where(eq(boRolePermissions.roleId, roleId));
  if (permissions.length > 0) {
    await db
      .insert(boRolePermissions)
      .values(permissions.map((permission) => ({ roleId, permissionId: permission.id })));
  }

  const usersWithRole = await db
    .select({ id: boUsers.id })
    .from(boUsers)
    .where(eq(boUsers.roleId, roleId));

  return {
    id: role.id,
    name: role.name,
    description: role.description,
    permissions: permissions.map((p) => p.key),
    userCount: usersWithRole.length,
  };
}

/**
 * Refuses to delete the "superadmin" role (there must always be at
 * least one role that can manage roles/users) and refuses to delete
 * any role that still has users assigned — the same "restrict" a
 * database FK would enforce, surfaced as a clear error instead of a
 * raw constraint violation. Reassign those users first.
 */
export async function deleteRole(roleId: string): Promise<void> {
  const [role] = await db.select().from(boRoles).where(eq(boRoles.id, roleId));
  if (!role) throw new NotFoundError("Role not found");

  if (role.name === "superadmin") {
    throw new ForbiddenError("The superadmin role can't be deleted");
  }

  const usersWithRole = await db
    .select({ id: boUsers.id })
    .from(boUsers)
    .where(eq(boUsers.roleId, roleId));
  if (usersWithRole.length > 0) {
    throw new ConflictError("Reassign every user off this role before deleting it");
  }

  await db.delete(boRolePermissions).where(eq(boRolePermissions.roleId, roleId));
  await db.delete(boRoles).where(eq(boRoles.id, roleId));
}
