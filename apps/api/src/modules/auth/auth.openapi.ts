import { registry } from "../../shared/openapi/registry";
import {
  googleLoginSchema,
  mfaCodeSchema,
  mfaResetRequestSchema,
  refreshSchema,
  loginOutcomeSchema,
  mfaSetupResponseSchema,
  mfaResetResponseSchema,
  tokenPairSchema,
  meResponseSchema,
} from "./auth.validators";

registry.registerPath({
  method: "post",
  path: "/auth/google",
  tags: ["Auth"],
  summary: "Sign in with Google",
  description:
    "Verifies a Google ID token and returns either an MFA-setup token (first login) or an MFA-challenge token (returning user). Never creates a new user — only a pre-provisioned bo_users row (from the seed script or a super-admin invite) can log in.",
  request: { body: { content: { "application/json": { schema: googleLoginSchema } } } },
  responses: {
    200: {
      description: "MFA setup or challenge required",
      content: { "application/json": { schema: loginOutcomeSchema } },
    },
    401: {
      description:
        "No matching account, account already linked to a different Google account, or account deactivated",
    },
  },
});

registry.registerPath({
  method: "post",
  path: "/auth/mfa/setup",
  tags: ["Auth"],
  summary: "Begin MFA enrollment (first login, or after a reset)",
  description:
    "Requires the mfa_setup token from /auth/google or /auth/mfa/reset as a Bearer token. Generates a TOTP secret and returns a QR code.",
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      description: "TOTP secret generated",
      content: { "application/json": { schema: mfaSetupResponseSchema } },
    },
    401: { description: "Invalid/expired setup token, or MFA already enabled" },
  },
});

registry.registerPath({
  method: "post",
  path: "/auth/mfa/verify-setup",
  tags: ["Auth"],
  summary: "Complete MFA enrollment",
  description:
    "Requires the mfa_setup token as a Bearer token. Confirms the first TOTP code, enables MFA, and issues real access + refresh tokens.",
  security: [{ bearerAuth: [] }],
  request: { body: { content: { "application/json": { schema: mfaCodeSchema } } } },
  responses: {
    200: {
      description: "MFA enabled, session issued",
      content: { "application/json": { schema: tokenPairSchema } },
    },
    401: { description: "Invalid code, or expired/missing setup token" },
  },
});

registry.registerPath({
  method: "post",
  path: "/auth/mfa/challenge",
  tags: ["Auth"],
  summary: "Submit MFA code (returning login)",
  description: "Requires the mfa_challenge token from /auth/google as a Bearer token.",
  security: [{ bearerAuth: [] }],
  request: { body: { content: { "application/json": { schema: mfaCodeSchema } } } },
  responses: {
    200: {
      description: "Session issued",
      content: { "application/json": { schema: tokenPairSchema } },
    },
    401: { description: "Invalid code, or expired/missing challenge token" },
    429: {
      description:
        "Five wrong codes for this account in 15 min, across challenge tokens — wait Retry-After seconds. code: TOO_MANY_ATTEMPTS",
    },
  },
});

registry.registerPath({
  method: "post",
  path: "/auth/mfa/reset",
  tags: ["Auth"],
  summary: "Reconfigure MFA for the current account (e.g. lost your phone)",
  description:
    "Requires a normal access token (Authorization header). If MFA is currently active, also requires the account's *current* TOTP code, proving continued control of the existing authenticator — omit it only if a previous reset was already abandoned mid-flow (no active secret left to check). On success, clears the current MFA secret and returns a fresh mfa_setup flow token — hand it to /auth/mfa/setup and /auth/mfa/verify-setup exactly like first-time enrollment. Safe to abandon: the current session keeps working either way.",
  security: [{ bearerAuth: [] }],
  request: { body: { content: { "application/json": { schema: mfaResetRequestSchema } } } },
  responses: {
    200: {
      description: "MFA reset — re-enroll via /auth/mfa/setup",
      content: { "application/json": { schema: mfaResetResponseSchema } },
    },
    401: {
      description:
        "Missing/invalid access token, code required but missing, or invalid current code",
    },
  },
});

registry.registerPath({
  method: "post",
  path: "/auth/refresh",
  tags: ["Auth"],
  summary: "Rotate a refresh token for a new session",
  description:
    "The presented refresh token is revoked and a new one issued, every time — a reused (already-rotated) token is rejected.",
  request: { body: { content: { "application/json": { schema: refreshSchema } } } },
  responses: {
    200: {
      description: "New session issued",
      content: { "application/json": { schema: tokenPairSchema } },
    },
    401: { description: "Refresh token invalid, expired, or already used" },
  },
});

registry.registerPath({
  method: "post",
  path: "/auth/logout",
  tags: ["Auth"],
  summary: "Revoke a refresh token",
  request: { body: { content: { "application/json": { schema: refreshSchema } } } },
  responses: {
    204: { description: "Revoked" },
  },
});

registry.registerPath({
  method: "get",
  path: "/auth/me",
  tags: ["Auth"],
  summary: "Get the current bo_user",
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      description: "Current user",
      content: { "application/json": { schema: meResponseSchema } },
    },
    401: { description: "Missing, invalid, or expired access token" },
  },
});
