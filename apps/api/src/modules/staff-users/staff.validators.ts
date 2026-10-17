import { z } from "../../shared/openapi/zod";
import { registry } from "../../shared/openapi/registry";
import { emailField } from "../../shared/fields";

export const staffIdParamsSchema = z.object({
  staffId: z.string().uuid(),
});

const nameField = z.string().trim().min(1).max(255).openapi({ example: "Jordan Rivera" });
const roleIdField = z.string().uuid().openapi({
  description:
    "A role of this business — see GET /staff/roles. Anyone but an owner may only give a role whose permissions they hold themselves.",
});

export const inviteStaffSchema = registry.register(
  "InviteStaffRequest",
  z.object({
    name: nameField,
    email: emailField.openapi({ example: "jordan@brightfix.com" }),
    roleId: roleIdField,
  }),
);

export const updateStaffSchema = registry.register(
  "UpdateStaffRequest",
  z.object({
    name: nameField.optional(),
    roleId: roleIdField.optional(),
  }),
);

export const setStaffActiveSchema = registry.register(
  "SetStaffActiveRequest",
  z.object({
    isActive: z.boolean(),
  }),
);

// Response shapes — mirror staff.service.ts's toStaffResponse.
export const staffMemberSchema = registry.register(
  "StaffMember",
  z.object({
    id: z.string(),
    accountId: z.string(),
    name: z.string(),
    email: z.string(),
    roleId: z.string().nullable(),
    roleName: z.string(),
    isOwner: z.boolean().openapi({ description: "Holds the business's Owner role." }),
    isActive: z.boolean(),
    claimed: z.boolean().openapi({
      description:
        'False until they have set up a password or linked Google through their invite — shown as "Invited".',
    }),
    mfaEnabled: z.boolean(),
    lastLoginAt: z.string().nullable().openapi({ format: "date-time" }),
    createdAt: z.string().openapi({ format: "date-time" }),
  }),
);

export const inviteOutcomeSchema = registry.register(
  "StaffInviteOutcome",
  z.object({
    emailed: z.boolean(),
    delivery: z.enum(["sent", "logged", "failed"]).openapi({
      description:
        '"logged" means no email provider is configured and the email was printed to the server console instead (local development) — it never reached them.',
    }),
    expiresAt: z.string().openapi({ format: "date-time" }),
  }),
);

export const inviteLinkSchema = registry.register(
  "StaffInviteLink",
  z.object({
    url: z.string().openapi({
      description: "The setup link — works once, for 7 days. Minting it retires any emailed one.",
    }),
    expiresAt: z.string().openapi({ format: "date-time" }),
  }),
);

export const staffMemberResponseSchema = registry.register(
  "StaffMemberResponse",
  z.object({ staff: staffMemberSchema }),
);

export const inviteStaffResponseSchema = registry.register(
  "InviteStaffResponse",
  z.object({ staff: staffMemberSchema, invite: inviteOutcomeSchema }),
);

export const staffListResponseSchema = registry.register(
  "StaffListResponse",
  z.object({ staff: z.array(staffMemberSchema) }),
);
