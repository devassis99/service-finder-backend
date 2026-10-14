import { z } from "../../shared/openapi/zod";
import { registry } from "../../shared/openapi/registry";

// Request bodies — the exact schemas roles.controller.ts uses to
// validate, registered here so they double as the OpenAPI source too.

export const createRoleSchema = registry.register(
  "CreateRoleRequest",
  z.object({
    name: z.string().min(1).openapi({ example: "Support Agent" }),
    description: z.string().optional(),
    permissionKeys: z.array(z.string()).openapi({
      example: ["overview.view", "users.view"],
      description: "See GET /roles/permissions for the full catalog",
    }),
  }),
);

export const updateRolePermissionsSchema = registry.register(
  "UpdateRolePermissionsRequest",
  z.object({
    permissionKeys: z.array(z.string()),
  }),
);

// Route params — plain (unregistered) schema, same convention as
// users.validators.ts's userIdParamsSchema.
export const roleIdParamsSchema = z.object({
  roleId: z.string().min(1),
});

// Response shapes — mirror what roles.service.ts actually returns.

export const roleSchema = registry.register(
  "BoRole",
  z.object({
    id: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    permissions: z
      .array(z.string())
      .openapi({ description: "Permission keys granted to this role" }),
    userCount: z.number().int(),
  }),
);

export const rolesListResponseSchema = registry.register(
  "RolesListResponse",
  z.object({ roles: z.array(roleSchema) }),
);

export const roleResponseSchema = registry.register("RoleResponse", z.object({ role: roleSchema }));

export const endpointRefSchema = registry.register(
  "BoEndpointRef",
  z.object({
    method: z.string(),
    path: z.string(),
    name: z.string(),
  }),
);

export const permissionCatalogEntrySchema = registry.register(
  "PermissionCatalogEntry",
  z.object({
    key: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    endpoints: z.array(endpointRefSchema).openapi({
      description:
        "Which API endpoints this permission unlocks — descriptive, not the enforcement mechanism itself (see requirePermission).",
    }),
  }),
);

export const permissionsCatalogResponseSchema = registry.register(
  "PermissionsCatalogResponse",
  z.object({ permissions: z.array(permissionCatalogEntrySchema) }),
);
