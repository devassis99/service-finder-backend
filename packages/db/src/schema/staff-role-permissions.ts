import { uuid, index, uniqueIndex } from "drizzle-orm/pg-core";
import { serviceFinderSchema } from "./_schema";
import { staffRoles } from "./staff-roles";
import { staffPermissions } from "./staff-permissions";
import { timestamps } from "./_helpers";

/** Which permissions each business role grants. */
export const staffRolePermissions = serviceFinderSchema.table(
  "staff_role_permissions",
  {
    id: uuid().primaryKey().defaultRandom(),
    roleId: uuid("role_id")
      .notNull()
      .references(() => staffRoles.id, { onDelete: "cascade" }),
    permissionId: uuid("permission_id")
      .notNull()
      .references(() => staffPermissions.id, { onDelete: "cascade" }),
    ...timestamps,
  },
  (table) => [
    index("staff_role_permissions_role_id_idx").on(table.roleId),
    uniqueIndex("staff_role_permissions_role_permission_uq").on(table.roleId, table.permissionId),
  ],
);

export type StaffRolePermission = typeof staffRolePermissions.$inferSelect;
export type NewStaffRolePermission = typeof staffRolePermissions.$inferInsert;
