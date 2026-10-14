import { registry } from "../../shared/openapi/registry";
import { z } from "../../shared/openapi/zod";
import {
  createRoleSchema,
  updateRolePermissionsSchema,
  rolesListResponseSchema,
  roleResponseSchema,
  permissionsCatalogResponseSchema,
} from "./roles.validators";

registry.registerPath({
  method: "get",
  path: "/roles",
  tags: ["Roles"],
  summary: "List roles",
  description: "Requires the roles.view permission.",
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      description: "Roles",
      content: { "application/json": { schema: rolesListResponseSchema } },
    },
    403: { description: "Missing the roles.view permission" },
  },
});

registry.registerPath({
  method: "get",
  path: "/roles/permissions",
  tags: ["Roles"],
  summary: "List the full permission catalog",
  description:
    "Every bo_permissions key, with the API endpoints it unlocks (descriptive metadata from bo_endpoints/bo_endpoint_permissions) — what the role editor's tab/functionality matrix is built from. Requires the roles.view permission.",
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      description: "Permission catalog",
      content: { "application/json": { schema: permissionsCatalogResponseSchema } },
    },
    403: { description: "Missing the roles.view permission" },
  },
});

registry.registerPath({
  method: "post",
  path: "/roles",
  tags: ["Roles"],
  summary: "Create a role",
  description: "Requires the roles.manage permission.",
  security: [{ bearerAuth: [] }],
  request: { body: { content: { "application/json": { schema: createRoleSchema } } } },
  responses: {
    201: {
      description: "Created",
      content: { "application/json": { schema: roleResponseSchema } },
    },
    404: { description: "One or more permission keys don't exist" },
    409: { description: "A role with this name already exists" },
    403: { description: "Missing the roles.manage permission" },
  },
});

registry.registerPath({
  method: "patch",
  path: "/roles/{roleId}/permissions",
  tags: ["Roles"],
  summary: "Replace a role's permission set",
  description: "Requires the roles.manage permission. Replaces the whole set, not a diff/patch.",
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ roleId: z.string() }),
    body: { content: { "application/json": { schema: updateRolePermissionsSchema } } },
  },
  responses: {
    200: {
      description: "Updated",
      content: { "application/json": { schema: roleResponseSchema } },
    },
    404: { description: "Role not found, or one or more permission keys don't exist" },
    403: { description: "Missing the roles.manage permission" },
  },
});

registry.registerPath({
  method: "delete",
  path: "/roles/{roleId}",
  tags: ["Roles"],
  summary: "Delete a role",
  description:
    "Requires the roles.manage permission. Refuses if the role is 'superadmin' or still has users assigned.",
  security: [{ bearerAuth: [] }],
  request: { params: z.object({ roleId: z.string() }) },
  responses: {
    204: { description: "Deleted" },
    403: { description: "Missing roles.manage, or attempting to delete the superadmin role" },
    404: { description: "Role not found" },
    409: { description: "Role still has users assigned" },
  },
});
