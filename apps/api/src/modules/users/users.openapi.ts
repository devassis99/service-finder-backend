import { registry } from "../../shared/openapi/registry";
import { z } from "../../shared/openapi/zod";
import {
  inviteUserSchema,
  updateUserRoleSchema,
  setUserActiveSchema,
  usersListResponseSchema,
  userResponseSchema,
} from "./users.validators";

registry.registerPath({
  method: "get",
  path: "/users",
  tags: ["Users"],
  summary: "List back-office users",
  description: "Requires the users.view permission.",
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      description: "Users",
      content: { "application/json": { schema: usersListResponseSchema } },
    },
    403: { description: "Missing the users.view permission" },
  },
});

registry.registerPath({
  method: "post",
  path: "/users",
  tags: ["Users"],
  summary: "Invite a back-office user",
  description:
    "Pre-provisions a bo_users row for this email with a role, but sends no email — tell the invitee out-of-band. The invitee signs in with Google using this exact email, is prompted through mandatory MFA setup on first login (identical to the seeded super admin), and their session then carries the assigned role's permissions. Requires the users.manage permission.",
  security: [{ bearerAuth: [] }],
  request: { body: { content: { "application/json": { schema: inviteUserSchema } } } },
  responses: {
    201: {
      description: "Invited",
      content: { "application/json": { schema: userResponseSchema } },
    },
    404: { description: "Role not found" },
    409: { description: "A user with this email already exists" },
    403: { description: "Missing the users.manage permission" },
  },
});

registry.registerPath({
  method: "patch",
  path: "/users/{userId}/role",
  tags: ["Users"],
  summary: "Reassign a user's role",
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ userId: z.string() }),
    body: { content: { "application/json": { schema: updateUserRoleSchema } } },
  },
  responses: {
    200: {
      description: "Updated",
      content: { "application/json": { schema: userResponseSchema } },
    },
    403: { description: "Missing users.manage, or attempting to change your own role" },
    404: { description: "User or role not found" },
  },
});

registry.registerPath({
  method: "patch",
  path: "/users/{userId}/active",
  tags: ["Users"],
  summary: "Activate or deactivate a user",
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ userId: z.string() }),
    body: { content: { "application/json": { schema: setUserActiveSchema } } },
  },
  responses: {
    200: {
      description: "Updated",
      content: { "application/json": { schema: userResponseSchema } },
    },
    403: { description: "Missing users.manage, or attempting to deactivate yourself" },
    404: { description: "User not found" },
  },
});
