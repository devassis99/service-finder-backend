import { uuid, index, uniqueIndex } from "drizzle-orm/pg-core";
import { serviceFinderSchema } from "./_schema";
import { boRoles } from "./bo-roles";
import { boPermissions } from "./bo-permissions";
import { timestamps } from "./_helpers";

export const boRolePermissions = serviceFinderSchema.table(
  "bo_role_permissions",
  {
    id: uuid().primaryKey().defaultRandom(),
    roleId: uuid("role_id")
      .notNull()
      .references(() => boRoles.id, { onDelete: "cascade" }),
    permissionId: uuid("permission_id")
      .notNull()
      .references(() => boPermissions.id, { onDelete: "cascade" }),
    ...timestamps,
  },
  (table) => [
    index("bo_role_permissions_role_id_idx").on(table.roleId),
    uniqueIndex("bo_role_permissions_role_permission_uq").on(table.roleId, table.permissionId),
  ],
);

export type BoRolePermission = typeof boRolePermissions.$inferSelect;
export type NewBoRolePermission = typeof boRolePermissions.$inferInsert;
