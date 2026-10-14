import type { NextFunction, Request, Response } from "express";
import { AuthError, ForbiddenError, getRolePermissionKeys } from "../../modules/auth/auth.service";

/**
 * Gates a route on the current user's role having a specific permission
 * key (bo_permissions.key, granted to a role via bo_role_permissions).
 * Must run after requireAuth, which is what sets req.boUser.
 *
 * This is the "requirePermission (bo_endpoints-driven)" mentioned in the
 * older admin-route comments across the app. bo_endpoints and
 * bo_endpoint_permissions still exist and are seeded (see
 * modules/roles/bo-permissions.seed.ts) as a documented catalog of which
 * permission unlocks which endpoint — surfaced to the Roles &
 * Permissions screen so an admin can see the API surface behind a
 * permission, not just a tab name. But the runtime check here is a
 * direct role -> permission lookup using the key given at the route
 * definition (same pattern as requireAuth itself), not a resolution of
 * req.route.path back to a bo_endpoints row. Path-template matching
 * against Express's parameterized/nested routes (mount prefixes,
 * trailing slashes, param placeholders) is exactly the kind of thing
 * that can fail silently open, and a permission check should never
 * take that risk.
 *
 * Lives here (not inside modules/auth/) because it's app-wide request
 * middleware, same as error-handler.ts and require-auth.middleware.ts
 * — every module's routes reach it via the auth module's public
 * surface (modules/auth/index.ts re-exports it), not by importing this
 * file directly.
 */
export function requirePermission(permissionKey: string) {
  return async function requirePermissionMiddleware(
    req: Request,
    _res: Response,
    next: NextFunction,
  ) {
    if (!req.boUser) {
      throw new AuthError("Missing bearer token");
    }

    const keys = await getRolePermissionKeys(req.boUser.roleId);
    if (!keys.includes(permissionKey)) {
      throw new ForbiddenError(`This action requires the "${permissionKey}" permission.`);
    }

    next();
  };
}
