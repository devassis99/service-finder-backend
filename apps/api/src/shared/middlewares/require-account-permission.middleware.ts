import type { NextFunction, Request, Response } from "express";
import { AuthError } from "../../modules/accounts/accounts.service";
import { getStaffRolePermissionKeys } from "../../modules/staff-roles/staff-roles.service";
import { ForbiddenError } from "../../modules/staff-users/staff.errors";
import { cachedForAccount } from "../account-cache";
import { AUTH_CACHE_MS } from "./require-account-auth.middleware";

/**
 * The business app's equivalent of require-permission.middleware.ts —
 * gates a route on the caller's role (staff_roles, via
 * req.staffUser.roleId) granting a permission key from
 * staff-roles.service.ts's DEFAULT_PERMISSIONS. Must run after
 * requireAccountAuth.
 *
 * Same "the key is named at the route definition" design as the back
 * office's, for the same reason: matching req.route.path back to a
 * catalog row is the kind of thing that fails open without anyone
 * noticing.
 *
 * Keys are cached per role for a minute and dropped with every change
 * the business makes (see require-account-auth.middleware.ts), so a
 * re-permissioned role applies on the next request.
 */
export function requireAccountPermission(permissionKey: string) {
  return async function requireAccountPermissionMiddleware(
    req: Request,
    _res: Response,
    next: NextFunction,
  ) {
    if (!req.staffUser) {
      throw new AuthError("Missing bearer token", "TOKEN_INVALID");
    }

    const roleId = req.staffUser.roleId;
    const keys = roleId
      ? await cachedForAccount(
          req.staffUser.accountId,
          `role-permissions:${roleId}`,
          AUTH_CACHE_MS,
          () => getStaffRolePermissionKeys(roleId),
        )
      : [];
    if (!keys.includes(permissionKey)) {
      throw new ForbiddenError(`This action requires the "${permissionKey}" permission.`);
    }

    next();
  };
}
