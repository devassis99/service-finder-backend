// This module's public surface — other modules and app.ts should only
// ever import from here, not reach into staff-roles' internal files
// directly.
export { staffRolesRouter } from "./staff-roles.routes";
export {
  DEFAULT_PERMISSIONS,
  seedDefaultRolesForAccount,
  getStaffRolePermissionKeys,
  ensurePermissionCatalog,
  NotFoundError,
  ConflictError,
  ForbiddenError,
} from "./staff-roles.service";
