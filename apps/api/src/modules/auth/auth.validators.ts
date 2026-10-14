import { z } from "../../shared/openapi/zod";
import { registry } from "../../shared/openapi/registry";

// Request bodies — the exact schemas auth.controller.ts uses to
// validate, registered here so they double as the OpenAPI source too.

export const googleLoginSchema = registry.register(
  "GoogleLoginRequest",
  z.object({
    idToken: z.string().min(1).openapi({
      description: "Google ID token obtained by the frontend via Google's client-side sign-in SDK",
    }),
  }),
);

export const mfaCodeSchema = registry.register(
  "MfaCodeRequest",
  z.object({
    code: z
      .string()
      .length(6)
      .openapi({ example: "123456", description: "6-digit TOTP code from the authenticator app" }),
  }),
);

export const mfaResetRequestSchema = registry.register(
  "MfaResetRequest",
  z.object({
    code: z.string().length(6).optional().openapi({
      example: "123456",
      description:
        "Current TOTP code — required unless MFA setup was already abandoned mid-reset (no active secret left to check against).",
    }),
  }),
);

export const refreshSchema = registry.register(
  "RefreshRequest",
  z.object({
    refreshToken: z.string().min(1),
  }),
);

// Response shapes — mirror what auth.service.ts actually returns.

export const loginOutcomeSchema = registry.register(
  "LoginOutcome",
  z.discriminatedUnion("status", [
    z.object({
      status: z.literal("mfa_setup_required"),
      setupToken: z.string().openapi({
        description: "Pass as a Bearer token to /auth/mfa/setup and /auth/mfa/verify-setup",
      }),
    }),
    z.object({
      status: z.literal("mfa_challenge_required"),
      challengeToken: z
        .string()
        .openapi({ description: "Pass as a Bearer token to /auth/mfa/challenge" }),
    }),
  ]),
);

export const mfaSetupResponseSchema = registry.register(
  "MfaSetupResponse",
  z.object({
    otpAuthUrl: z.string().openapi({
      description: "otpauth:// URI — usually rendered as a QR code instead of shown directly",
    }),
    qrCodeDataUrl: z.string().openapi({ description: "Ready-to-render QR code as a data: URL" }),
  }),
);

export const tokenPairSchema = registry.register(
  "TokenPair",
  z.object({
    accessToken: z.string().openapi({
      description: "Short-lived (15m) JWT — send as `Authorization: Bearer <accessToken>`",
    }),
    refreshToken: z.string().openapi({
      description: "Long-lived (30d), single-use — rotates on every /auth/refresh call",
    }),
  }),
);

export const mfaResetResponseSchema = registry.register(
  "MfaResetResponse",
  z.object({
    setupToken: z.string().openapi({
      description:
        "Pass as a Bearer token to /auth/mfa/setup and /auth/mfa/verify-setup, exactly like a first-time enrollment.",
    }),
  }),
);

export const meResponseSchema = registry.register(
  "MeResponse",
  z.object({
    user: z.object({
      id: z.string(),
      roleId: z.string(),
      email: z.string(),
      mfaEnabled: z.boolean(),
    }),
    role: z
      .object({
        id: z.string(),
        name: z.string(),
      })
      .nullable(),
    permissions: z.array(z.string()).openapi({
      description: "Permission keys granted to this user's role — drives what the frontend shows.",
    }),
  }),
);
