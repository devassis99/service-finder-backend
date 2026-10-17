import { registry } from "../../shared/openapi/registry";
import { z } from "../../shared/openapi/zod";
import {
  inviteStaffSchema,
  updateStaffSchema,
  setStaffActiveSchema,
  staffMemberResponseSchema,
  staffListResponseSchema,
  inviteStaffResponseSchema,
  inviteOutcomeSchema,
  inviteLinkSchema,
} from "./staff.validators";

const staffIdParams = z.object({ staffId: z.string().uuid() });

const reachNote =
  "Anyone but an owner is refused (403) for a member whose role grants a permission they don't hold themselves, and for an owner.";

registry.registerPath({
  method: "get",
  path: "/staff",
  tags: ["Business Team"],
  summary: "List the team",
  description:
    "Everyone on the business, oldest first — including invited and deactivated members.",
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      description: "Team",
      content: { "application/json": { schema: staffListResponseSchema } },
    },
    403: { description: "Caller lacks staff.view" },
  },
});

registry.registerPath({
  method: "post",
  path: "/staff",
  tags: ["Business Team"],
  summary: "Invite someone",
  description:
    "Creates their account with no way to sign in yet and emails them a single-use setup link (7 days). Anyone but an owner may only give a role whose permissions they hold themselves. A mail failure doesn't fail the request — see `invite.delivery`.",
  security: [{ bearerAuth: [] }],
  request: { body: { content: { "application/json": { schema: inviteStaffSchema } } } },
  responses: {
    201: {
      description: "Invited",
      content: { "application/json": { schema: inviteStaffResponseSchema } },
    },
    403: { description: "Caller lacks staff.manage, or the role is beyond their own" },
    404: { description: "No such role in this business" },
    409: { description: "Someone with this email already has a business account" },
  },
});

registry.registerPath({
  method: "patch",
  path: "/staff/{staffId}",
  tags: ["Business Team"],
  summary: "Change a member's name or role",
  description: `Nobody changes their own role, and the last active owner can't be moved off Owner. ${reachNote} The new role is held to the same rule.`,
  security: [{ bearerAuth: [] }],
  request: {
    params: staffIdParams,
    body: { content: { "application/json": { schema: updateStaffSchema } } },
  },
  responses: {
    200: {
      description: "Updated",
      content: { "application/json": { schema: staffMemberResponseSchema } },
    },
    403: { description: "Caller lacks staff.manage, or one of the rules above" },
    404: { description: "No such member or role in this business" },
  },
});

registry.registerPath({
  method: "patch",
  path: "/staff/{staffId}/active",
  tags: ["Business Team"],
  summary: "Deactivate or reactivate a member",
  description: `Deactivating ends every session of theirs at once. Nobody deactivates themselves, and the last active owner can't be. ${reachNote}`,
  security: [{ bearerAuth: [] }],
  request: {
    params: staffIdParams,
    body: { content: { "application/json": { schema: setStaffActiveSchema } } },
  },
  responses: {
    200: {
      description: "Updated",
      content: { "application/json": { schema: staffMemberResponseSchema } },
    },
    403: { description: "Caller lacks staff.manage, or one of the rules above" },
    404: { description: "No such member in this business" },
  },
});

registry.registerPath({
  method: "post",
  path: "/staff/{staffId}/invite/resend",
  tags: ["Business Team"],
  summary: "Email a fresh setup link",
  description: `For a member who hasn't set themselves up yet. Retires any earlier link. ${reachNote}`,
  security: [{ bearerAuth: [] }],
  request: { params: staffIdParams },
  responses: {
    200: {
      description: "Sent (or logged, or failed — see delivery)",
      content: { "application/json": { schema: z.object({ invite: inviteOutcomeSchema }) } },
    },
    403: { description: "Caller lacks staff.manage, or the member is beyond their reach" },
    404: { description: "No such member in this business" },
    409: { description: "They've already set up their account, or are deactivated" },
  },
});

registry.registerPath({
  method: "post",
  path: "/staff/{staffId}/invite/link",
  tags: ["Business Team"],
  summary: "Get a setup link to pass on by hand",
  description: `Sends nothing. Minting it retires the link that was emailed. ${reachNote}`,
  security: [{ bearerAuth: [] }],
  request: { params: staffIdParams },
  responses: {
    200: {
      description: "Link",
      content: { "application/json": { schema: z.object({ invite: inviteLinkSchema }) } },
    },
    403: { description: "Caller lacks staff.manage, or the member is beyond their reach" },
    404: { description: "No such member in this business" },
    409: { description: "They've already set up their account, or are deactivated" },
  },
});
