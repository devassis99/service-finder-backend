import { uuid, index, uniqueIndex } from "drizzle-orm/pg-core";
import { serviceFinderSchema } from "./_schema";
import { boEndpoints } from "./bo-endpoints";
import { boPermissions } from "./bo-permissions";
import { timestamps } from "./_helpers";

export const boEndpointPermissions = serviceFinderSchema.table(
  "bo_endpoint_permissions",
  {
    id: uuid().primaryKey().defaultRandom(),
    endpointId: uuid("endpoint_id")
      .notNull()
      .references(() => boEndpoints.id, { onDelete: "cascade" }),
    permissionId: uuid("permission_id")
      .notNull()
      .references(() => boPermissions.id, { onDelete: "cascade" }),
    ...timestamps,
  },
  (table) => [
    index("bo_endpoint_permissions_endpoint_id_idx").on(table.endpointId),
    uniqueIndex("bo_endpoint_permissions_endpoint_permission_uq").on(
      table.endpointId,
      table.permissionId,
    ),
  ],
);

export type BoEndpointPermission = typeof boEndpointPermissions.$inferSelect;
export type NewBoEndpointPermission = typeof boEndpointPermissions.$inferInsert;
