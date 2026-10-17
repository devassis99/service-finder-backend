import { registry } from "../../shared/openapi/registry";
import { z } from "../../shared/openapi/zod";
import {
  createRoleSchema,
  updateRoleSchema,
  updateRolePermissionsSchema,
  staffRoleResponseSchema,
  staffRoleListResponseSchema,
  staffPermissionsCatalogResponseSchema,
} from "./staff-roles.validators";

const roleIdParams = z.object({ roleId: z.string().uuid() });

const beyondCallerNote =
  "Anyone but an owner is refused (403) for a role that grants a permission they don't hold themselves, and for the Owner role.";

registry.registerPath({
  method: "get",
  path: "/staff/roles",
  tags: ["Business Roles"],
  summary: "List the business's roles",
  description: "Owner first, then oldest first. Each with its permission keys and member count.",
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      description: "Roles",
      content: { "application/json": { schema: staffRoleListResponseSchema } },
    },
    403: { description: "Caller lacks roles.view" },
  },
});

registry.registerPath({
  method: "get",
  path: "/staff/roles/permissions",
  tags: ["Business Roles"],
  summary: "List the permission catalog",
  description:
    "Not business-specific — the fixed vocabulary every role's permission set is built from, in display order.",
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      description: "Permission catalog",
      content: { "application/json": { schema: staffPermissionsCatalogResponseSchema } },
    },
    403: { description: "Caller lacks roles.view" },
  },
});

registry.registerPath({
  method: "post",
  path: "/staff/roles",
  tags: ["Business Roles"],
  summary: "Create a role",
  description: `Anyone but an owner may only grant permissions their own role has.`,
  security: [{ bearerAuth: [] }],
  request: { body: { content: { "application/json": { schema: createRoleSchema } } } },
  responses: {
    201: {
      description: "Created",
      content: { "application/json": { schema: staffRoleResponseSchema } },
    },
    403: { description: "Caller lacks roles.manage, or is granting a permission they don't have" },
    404: { description: "An unknown permission key" },
    409: { description: "A role with this name already exists" },
  },
});

registry.registerPath({
  method: "patch",
  path: "/staff/roles/{roleId}",
  tags: ["Business Roles"],
  summary: "Rename or re-describe a role",
  description: `The Owner role can't be renamed. ${beyondCallerNote}`,
  security: [{ bearerAuth: [] }],
  request: {
    params: roleIdParams,
    body: { content: { "application/json": { schema: updateRoleSchema } } },
  },
  responses: {
    200: {
      description: "Updated",
      content: { "application/json": { schema: staffRoleResponseSchema } },
    },
    403: {
      description: "Caller lacks roles.manage, the role is out of their reach, or it's Owner",
    },
    404: { description: "No such role in this business" },
    409: { description: "Another role already has this name" },
  },
});

registry.registerPath({
  method: "patch",
  path: "/staff/roles/{roleId}/permissions",
  tags: ["Business Roles"],
  summary: "Replace a role's permissions",
  description: `The Owner role always has every permission and can't be edited. ${beyondCallerNote} The new set is held to the same rule.`,
  security: [{ bearerAuth: [] }],
  request: {
    params: roleIdParams,
    body: { content: { "application/json": { schema: updateRolePermissionsSchema } } },
  },
  responses: {
    200: {
      description: "Updated",
      content: { "application/json": { schema: staffRoleResponseSchema } },
    },
    403: { description: "Caller lacks roles.manage, or the role or new set is out of their reach" },
    404: { description: "No such role, or an unknown permission key" },
  },
});

registry.registerPath({
  method: "delete",
  path: "/staff/roles/{roleId}",
  tags: ["Business Roles"],
  summary: "Delete a role",
  description: `Refused for the Owner role and for any role someone still holds. ${beyondCallerNote}`,
  security: [{ bearerAuth: [] }],
  request: { params: roleIdParams },
  responses: {
    204: { description: "Deleted" },
    403: {
      description: "Caller lacks roles.manage, the role is out of their reach, or it's Owner",
    },
    404: { description: "No such role in this business" },
    409: { description: "Someone still has this role" },
  },
});
