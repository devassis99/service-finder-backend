import { z } from "../../shared/openapi/zod";
import { registry } from "../../shared/openapi/registry";

export const roleIdParamsSchema = z.object({
  roleId: z.string().uuid(),
});

const permissionKeysField = z
  .array(z.string().min(1).max(100))
  .max(100)
  .openapi({
    example: ["staff.view", "staff.manage"],
    description:
      "See GET /staff/roles/permissions for the catalog. Anyone but an owner may only grant permissions their own role has.",
  });

export const createRoleSchema = registry.register(
  "CreateStaffRoleRequest",
  z.object({
    name: z.string().trim().min(1).max(100).openapi({ example: "Dispatcher" }),
    description: z.string().trim().max(500).optional(),
    permissionKeys: permissionKeysField,
  }),
);

export const updateRoleSchema = registry.register(
  "UpdateStaffRoleRequest",
  z.object({
    name: z.string().trim().min(1).max(100).optional(),
    description: z.string().trim().max(500).nullable().optional(),
  }),
);

export const updateRolePermissionsSchema = registry.register(
  "UpdateStaffRolePermissionsRequest",
  z.object({
    permissionKeys: permissionKeysField,
  }),
);

export const staffRoleSchema = registry.register(
  "StaffRoleDef",
  z.object({
    id: z.string(),
    accountId: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    isSystem: z.boolean().openapi({
      description:
        "True only for the business's Owner role — it can't be renamed, re-permissioned or deleted, and only an owner can assign it.",
    }),
    permissions: z.array(z.string()),
    memberCount: z.number().int(),
    createdAt: z.string().openapi({ format: "date-time" }),
  }),
);

export const staffRoleListResponseSchema = registry.register(
  "StaffRoleListResponse",
  z.object({ roles: z.array(staffRoleSchema) }),
);

export const staffRoleResponseSchema = registry.register(
  "StaffRoleResponse",
  z.object({ role: staffRoleSchema }),
);

export const staffPermissionCatalogEntrySchema = registry.register(
  "StaffPermissionCatalogEntry",
  z.object({
    key: z.string(),
    name: z.string(),
    description: z.string().nullable(),
  }),
);

export const staffPermissionsCatalogResponseSchema = registry.register(
  "StaffPermissionsCatalogResponse",
  z.object({ permissions: z.array(staffPermissionCatalogEntrySchema) }),
);
