import { uuid, varchar, text } from "drizzle-orm/pg-core";
import { serviceFinderSchema } from "./_schema";
import { timestamps } from "./_helpers";

/**
 * The fixed catalog of permission keys a business role can be granted —
 * the same "keys are the enforcement vocabulary" shape as bo_permissions,
 * but for the business app. Global, never per-business: a custom role
 * (staff_roles) picks a subset of these through staff_role_permissions.
 *
 * Kept in step with the code by the API itself — see
 * staff-roles.service.ts's ensurePermissionCatalog, which runs at every
 * boot and grants any newly added key to every business's Owner role.
 */
export const staffPermissions = serviceFinderSchema.table("staff_permissions", {
  id: uuid().primaryKey().defaultRandom(),
  key: varchar({ length: 100 }).notNull().unique(),
  name: varchar({ length: 255 }).notNull(),
  description: text(),
  ...timestamps,
});

export type StaffPermission = typeof staffPermissions.$inferSelect;
export type NewStaffPermission = typeof staffPermissions.$inferInsert;
