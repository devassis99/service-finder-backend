import { registry } from "../../shared/openapi/registry";
import { z } from "../../shared/openapi/zod";
import {
  signupSchema,
  loginSchema,
  googleLoginSchema,
  refreshSchema,
  tokenPairSchema,
  loginOutcomeSchema,
  googleLoginOutcomeSchema,
  meResponseSchema,
  updateOwnProfileSchema,
  updateBusinessSchema,
  businessResponseSchema,
  confirmSetPasswordSchema,
  setInitialPasswordSchema,
  mfaSetupResponseSchema,
  mfaCodeSchema,
  mfaChallengeConfirmSchema,
  sessionsListResponseSchema,
  revokeOtherSessionsSchema,
  redeemInviteSchema,
  redeemInviteResponseSchema,
} from "./accounts.validators";

const tag = ["Business Accounts"];
const json = <T extends z.ZodTypeAny>(schema: T) => ({
  content: { "application/json": { schema } },
});
const refreshTokenHeader = [
  z
    .string()
    .optional()
    .openapi({
      param: { name: "X-Refresh-Token", in: "header" },
      description: "The caller's own refresh token — marks which session is this device.",
    }),
];

// --- Public ----------------------------------------------------------------

registry.registerPath({
  method: "post",
  path: "/accounts/signup",
  tags: tag,
  summary: "Sign a business up",
  description:
    "Creates the business, its default roles (Owner, Manager, Member) and its owner, and signs the owner in. Sign-in is by password, Google (the token's verified email must be workEmail), or both. 10 an hour per device.",
  request: { body: json(signupSchema) },
  responses: {
    201: { description: "Created and signed in", ...json(tokenPairSchema) },
    401: { description: "Google token invalid, unverified, or for a different email" },
    409: { description: "This email (or Google account) already signs in to a business" },
    429: { description: "Too many sign-ups from this device" },
  },
});

registry.registerPath({
  method: "post",
  path: "/accounts/login",
  tags: tag,
  summary: "Sign in with email and password",
  description:
    "Returns a session, or — for someone with two-factor on — a challenge token for POST /accounts/mfa/challenge. Rate-limited per account, per device and per both.",
  request: { body: json(loginSchema) },
  responses: {
    200: { description: "Signed in, or two-factor required", ...json(loginOutcomeSchema) },
    401: { description: "Wrong email or password, or the account is deactivated" },
    429: { description: "Too many attempts" },
  },
});

registry.registerPath({
  method: "post",
  path: "/accounts/google",
  tags: tag,
  summary: "Sign in with Google",
  description:
    'A Google identity matching nobody returns "no_account" (not an error): carry on into sign-up with the same token. One matching a member\'s email but not yet linked is linked.',
  request: { body: json(googleLoginSchema) },
  responses: {
    200: {
      description: "Signed in, two-factor required, or no account",
      ...json(googleLoginOutcomeSchema),
    },
    401: { description: "Token invalid or unverified, linked elsewhere, or account deactivated" },
  },
});

registry.registerPath({
  method: "post",
  path: "/accounts/mfa/challenge",
  tags: tag,
  summary: "Finish signing in with an authenticator code",
  description: "5 wrong codes per person per 15 minutes, across every challenge token.",
  request: { body: json(mfaChallengeConfirmSchema) },
  responses: {
    200: { description: "Signed in", ...json(tokenPairSchema) },
    401: { description: "Wrong code, or the challenge expired" },
    429: { description: "Too many wrong codes" },
  },
});

registry.registerPath({
  method: "post",
  path: "/accounts/refresh",
  tags: tag,
  summary: "Rotate a refresh token",
  description: "Single-use: the token sent is retired, and a new pair comes back.",
  request: { body: json(refreshSchema) },
  responses: {
    200: { description: "New pair", ...json(tokenPairSchema) },
    401: { description: "Unknown, used, revoked or expired — or the member is deactivated" },
  },
});

registry.registerPath({
  method: "post",
  path: "/accounts/logout",
  tags: tag,
  summary: "Sign out (revoke a refresh token)",
  request: { body: json(refreshSchema) },
  responses: { 204: { description: "Signed out" } },
});

registry.registerPath({
  method: "post",
  path: "/accounts/invite/redeem",
  tags: tag,
  summary: "Open an invite",
  description:
    "Exchanges the token from an invite link (/invite#<token>) for a session. Single-use. needsSignInMethod says the welcome screen must collect a password or a Google link before they leave.",
  request: { body: json(redeemInviteSchema) },
  responses: {
    200: { description: "Signed in", ...json(redeemInviteResponseSchema) },
    404: { description: "Unknown, used, replaced or expired — deliberately indistinguishable" },
    409: { description: "The member has been deactivated" },
  },
});

// --- Signed in ---------------------------------------------------------------

registry.registerPath({
  method: "get",
  path: "/accounts/me",
  tags: tag,
  summary: "Who am I",
  description: "The caller, their role's permission keys, and their business.",
  security: [{ bearerAuth: [] }],
  responses: {
    200: { description: "Me", ...json(meResponseSchema) },
    401: { description: "Missing or invalid token (code TOKEN_INVALID)" },
  },
});

registry.registerPath({
  method: "patch",
  path: "/accounts/me/profile",
  tags: tag,
  summary: "Change my name",
  security: [{ bearerAuth: [] }],
  request: { body: json(updateOwnProfileSchema) },
  responses: { 200: { description: "Updated", ...json(meResponseSchema) } },
});

registry.registerPath({
  method: "patch",
  path: "/accounts/settings/business",
  tags: tag,
  summary: "Edit the business profile",
  description: "Name, contact email and phone. The slug never changes.",
  security: [{ bearerAuth: [] }],
  request: { body: json(updateBusinessSchema) },
  responses: {
    200: { description: "Updated", ...json(businessResponseSchema) },
    403: { description: "Caller lacks business.manage" },
  },
});

registry.registerPath({
  method: "post",
  path: "/accounts/me/password/initial",
  tags: tag,
  summary: "Set a first password",
  description:
    "Only while the caller has no password at all — after that, use the coded flow below.",
  security: [{ bearerAuth: [] }],
  request: { body: json(setInitialPasswordSchema) },
  responses: {
    204: { description: "Set" },
    409: { description: "They already have a password" },
  },
});

registry.registerPath({
  method: "post",
  path: "/accounts/security/password/request-code",
  tags: tag,
  summary: "Email me a code to change my password",
  description: "For someone without two-factor. One a minute per person; 20 an hour per device.",
  security: [{ bearerAuth: [] }],
  responses: {
    204: { description: "Sent" },
    409: { description: "Two-factor is on (use the authenticator), or asked again too soon" },
    429: { description: "Too many codes from this device" },
  },
});

registry.registerPath({
  method: "post",
  path: "/accounts/security/password/confirm",
  tags: tag,
  summary: "Set or change my password",
  description:
    "With the emailed code, or the authenticator code for someone with two-factor on. Every other session is signed out; send X-Refresh-Token to keep this one.",
  security: [{ bearerAuth: [] }],
  request: { headers: refreshTokenHeader, body: json(confirmSetPasswordSchema) },
  responses: {
    204: { description: "Changed" },
    401: { description: "Wrong, expired or missing code" },
  },
});

registry.registerPath({
  method: "post",
  path: "/accounts/security/mfa/setup",
  tags: tag,
  summary: "Start turning on two-factor",
  description: "A new secret and QR code. Two-factor stays off until /security/mfa/confirm.",
  security: [{ bearerAuth: [] }],
  responses: {
    200: { description: "Secret", ...json(mfaSetupResponseSchema) },
    409: { description: "Already on" },
  },
});

registry.registerPath({
  method: "post",
  path: "/accounts/security/mfa/confirm",
  tags: tag,
  summary: "Finish turning on two-factor",
  security: [{ bearerAuth: [] }],
  request: { body: json(mfaCodeSchema) },
  responses: {
    204: { description: "On" },
    401: { description: "Wrong code, or setup not started" },
    409: { description: "Already on" },
  },
});

registry.registerPath({
  method: "post",
  path: "/accounts/security/mfa/disable",
  tags: tag,
  summary: "Turn off two-factor",
  description: "Needs a live authenticator code.",
  security: [{ bearerAuth: [] }],
  request: { body: json(mfaCodeSchema) },
  responses: {
    204: { description: "Off" },
    401: { description: "Wrong code" },
    409: { description: "Not on" },
  },
});

registry.registerPath({
  method: "get",
  path: "/accounts/security/sessions",
  tags: tag,
  summary: "List my signed-in sessions",
  security: [{ bearerAuth: [] }],
  request: { headers: refreshTokenHeader },
  responses: { 200: { description: "Sessions", ...json(sessionsListResponseSchema) } },
});

registry.registerPath({
  method: "post",
  path: "/accounts/security/sessions/{sessionId}/revoke",
  tags: tag,
  summary: "Sign one session out",
  security: [{ bearerAuth: [] }],
  request: { params: z.object({ sessionId: z.string().uuid() }) },
  responses: {
    204: { description: "Signed out" },
    404: { description: "Not one of the caller's live sessions" },
  },
});

registry.registerPath({
  method: "post",
  path: "/accounts/security/sessions/revoke-others",
  tags: tag,
  summary: "Sign out everywhere else",
  security: [{ bearerAuth: [] }],
  request: { body: json(revokeOtherSessionsSchema) },
  responses: { 204: { description: "Every other session signed out" } },
});
