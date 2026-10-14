import { z } from "../../shared/openapi/zod";
import { registry } from "../../shared/openapi/registry";

// Request bodies — the exact schemas users.controller.ts uses to
// validate, registered here so they double as the OpenAPI source too.

export const inviteUserSchema = registry.register(
  "InviteUserRequest",
  z.object({
    email: z.string().email().openapi({ example: "new.hire@example.com" }),
    name: z.string().min(1).openapi({ example: "Jordan Lee" }),
    roleId: z.string().min(1).openapi({
      description: "bo_roles.id this user is assigned on invite. See GET /roles for choices.",
    }),
  }),
);

export const updateUserRoleSchema = registry.register(
  "UpdateUserRoleRequest",
  z.object({
    roleId: z.string().min(1),
  }),
);

export const setUserActiveSchema = registry.register(
  "SetUserActiveRequest",
  z.object({
    isActive: z.boolean(),
  }),
);

// Route params — plain (unregistered) schema: turns Express's
// `string | string[]` req.params typing into a real, validated `string`.
export const userIdParamsSchema = z.object({
  userId: z.string().min(1),
});

// Response shapes — mirror what users.service.ts actually returns.

export const boUserSchema = registry.register(
  "BoUser",
  z.object({
    id: z.string(),
    name: z.string(),
    email: z.string(),
    roleId: z.string(),
    roleName: z.string(),
    isActive: z.boolean(),
    mfaEnabled: z.boolean(),
    claimed: z.boolean().openapi({
      description:
        "Whether this invite has been accepted — the invited email has signed in with Google at least once and bound its account. False means it's still just a pending invite.",
    }),
    lastLoginAt: z.string().nullable().openapi({ format: "date-time" }),
    createdAt: z.string().openapi({ format: "date-time" }),
  }),
);

export const usersListResponseSchema = registry.register(
  "UsersListResponse",
  z.object({ users: z.array(boUserSchema) }),
);

export const userResponseSchema = registry.register(
  "UserResponse",
  z.object({ user: boUserSchema }),
);
