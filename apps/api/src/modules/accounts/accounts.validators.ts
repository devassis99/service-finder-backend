import { z } from "../../shared/openapi/zod";
import { registry } from "../../shared/openapi/registry";
import { emailField } from "../../shared/fields";

/** Same rule everywhere a password is chosen: at least 8 characters, at most 200 (scrypt has no length cap of its own, so the upper bound stops a megabyte "password" costing a megabyte of hashing). */
export const newPasswordField = z.string().min(8).max(200);

export const signupSchema = registry.register(
  "AccountSignupRequest",
  z
    .object({
      fullName: z.string().trim().min(1).max(255).openapi({ example: "Amara Okafor" }),
      workEmail: emailField.openapi({ example: "amara@brightfix.com" }),
      password: newPasswordField.optional().openapi({
        description: "Required unless googleIdToken is provided",
      }),
      googleIdToken: z.string().min(1).optional().openapi({
        description:
          "Google ID token from the business app's Google sign-in. Required unless password is provided; its email must match workEmail.",
      }),
      businessName: z.string().trim().min(1).max(255).openapi({ example: "BrightFix Repairs" }),
      phone: z.string().trim().max(50).optional(),
    })
    .refine((data) => Boolean(data.password) || Boolean(data.googleIdToken), {
      message: "Provide a password or a Google ID token",
      path: ["password"],
    }),
);

export const loginSchema = registry.register(
  "AccountLoginRequest",
  z.object({
    email: emailField,
    password: z.string().min(1).max(200),
  }),
);

export const googleLoginSchema = registry.register(
  "AccountGoogleLoginRequest",
  z.object({
    idToken: z.string().min(1).openapi({
      description: "Google ID token obtained by the frontend via Google's client-side sign-in SDK",
    }),
  }),
);

export const refreshSchema = registry.register(
  "AccountRefreshRequest",
  z.object({
    refreshToken: z.string().min(1),
  }),
);

export const tokenPairSchema = registry.register(
  "AccountTokenPair",
  z.object({
    accessToken: z.string().openapi({
      description: "Short-lived (15m) JWT — send as `Authorization: Bearer <accessToken>`",
    }),
    refreshToken: z.string().openapi({
      description: "Long-lived (30d), single-use — rotates on every /accounts/refresh call",
    }),
  }),
);

const mfaChallengeRequiredOutcomeSchema = z
  .object({
    status: z.literal("mfa_challenge_required"),
    challengeToken: z.string().openapi({
      description:
        "Short-lived (5m) token — pass as `challengeToken` to POST /accounts/mfa/challenge along with the authenticator app code to finish signing in.",
    }),
  })
  .openapi({
    description: "Password/Google identity confirmed, but this person has 2FA turned on.",
  });

const okOutcomeSchema = z.object({
  status: z.literal("ok"),
  accessToken: z.string(),
  refreshToken: z.string(),
});

export const loginOutcomeSchema = registry.register(
  "AccountLoginOutcome",
  z.discriminatedUnion("status", [okOutcomeSchema, mfaChallengeRequiredOutcomeSchema]),
);

export const googleLoginOutcomeSchema = registry.register(
  "AccountGoogleLoginOutcome",
  z.discriminatedUnion("status", [
    okOutcomeSchema,
    mfaChallengeRequiredOutcomeSchema,
    z
      .object({
        status: z.literal("no_account"),
        email: z.string(),
        name: z.string().optional(),
      })
      .openapi({
        description:
          "Nobody on any business signs in with this Google identity — continue the visitor through sign-up and call POST /accounts/signup with this same idToken.",
      }),
  ]),
);

export const accountSchema = registry.register(
  "Account",
  z.object({
    id: z.string(),
    name: z.string(),
    slug: z.string(),
    email: z.string(),
    phone: z.string().nullable(),
    createdAt: z.string().openapi({ format: "date-time" }),
  }),
);

export const meResponseSchema = registry.register(
  "AccountMeResponse",
  z.object({
    staffUser: z.object({
      id: z.string(),
      accountId: z.string(),
      name: z.string(),
      email: z.string(),
      roleId: z.string().nullable(),
      roleName: z.string(),
      isOwner: z.boolean().openapi({
        description:
          "Whether the caller holds the business's Owner (system) role — sent as a fact about the role, not inferred from its name, which can't change but shouldn't have to be compared.",
      }),
      hasPassword: z.boolean().openapi({
        description:
          'False for someone who has only ever signed in with Google — Security settings shows "Set password" instead of "Change password".',
      }),
      hasGoogle: z.boolean(),
      mfaEnabled: z.boolean().openapi({
        description:
          "Whether two-factor is on — decides whether POST /accounts/security/password/confirm expects `code` (emailed) or `totpCode` (authenticator app).",
      }),
      lastLoginAt: z.string().nullable().openapi({ format: "date-time" }),
      createdAt: z.string().openapi({ format: "date-time" }),
    }),
    permissions: z.array(z.string()).openapi({
      description:
        "Permission keys the caller's role grants — see GET /staff/roles/permissions for the catalog",
    }),
    account: accountSchema,
  }),
);

/** The caller editing their own name. Open to any signed-in member — see PATCH /staff/{id} for the version that can also change a role. */
export const updateOwnProfileSchema = registry.register(
  "UpdateOwnProfileRequest",
  z.object({
    name: z.string().trim().min(1).max(255),
  }),
);

/** Business profile — Settings → Business. Each field optional; omitted leaves it alone, null clears the phone. */
export const updateBusinessSchema = registry.register(
  "UpdateBusinessRequest",
  z.object({
    name: z.string().trim().min(1).max(255).optional(),
    email: emailField.optional().openapi({
      description:
        "Where account-level email goes. Changing it never changes how anyone signs in — that's each member's own email.",
    }),
    phone: z.string().trim().max(50).nullable().optional(),
  }),
);

export const businessResponseSchema = registry.register(
  "BusinessResponse",
  z.object({ account: accountSchema }),
);

/**
 * Security page's Set/Change password flow. `code` (the emailed 6-digit
 * code from POST /accounts/security/password/request-code) is required
 * unless the caller has two-factor on, in which case `totpCode` (from
 * their authenticator app) is required instead — see security.service.ts.
 */
export const confirmSetPasswordSchema = registry.register(
  "AccountConfirmSetPasswordRequest",
  z
    .object({
      newPassword: newPasswordField,
      code: z.string().length(6).optional().openapi({
        description: "The emailed verification code — required unless the caller has 2FA on.",
      }),
      totpCode: z.string().length(6).optional().openapi({
        description: "The authenticator app code — required only when the caller has 2FA on.",
      }),
    })
    .refine((data) => Boolean(data.code) !== Boolean(data.totpCode), {
      message: "Provide exactly one of code or totpCode",
    }),
);

/** First-time password for an invited member — no verification code, see security.service.ts's setInitialPassword. */
export const setInitialPasswordSchema = registry.register(
  "SetInitialPasswordRequest",
  z.object({ newPassword: newPasswordField }),
);

/** Security page's two-factor row, step 1 response — scan the QR code, or type `secret` in. */
export const mfaSetupResponseSchema = registry.register(
  "AccountMfaSetupResponse",
  z.object({
    secret: z.string().openapi({
      description: "Manual-entry fallback if the authenticator app can't scan the QR code.",
    }),
    qrCodeDataUrl: z.string().openapi({
      description: "data: URL PNG — render directly as an <img src>.",
    }),
  }),
);

/** A bare 6-digit authenticator code — confirms enrollment, and turns 2FA off. */
export const mfaCodeSchema = registry.register(
  "AccountMfaCodeRequest",
  z.object({
    code: z.string().length(6),
  }),
);

/** POST /accounts/mfa/challenge — the second step of signing in for someone with 2FA on. */
export const mfaChallengeConfirmSchema = registry.register(
  "AccountMfaChallengeConfirmRequest",
  z.object({
    challengeToken: z.string().min(1).openapi({
      description: "From the mfa_challenge_required outcome of /accounts/login or /accounts/google",
    }),
    code: z.string().length(6),
  }),
);

/** One row of the Security page's "Active sessions" list — see security.service.ts's listSessions. */
export const sessionSchema = registry.register(
  "AccountSession",
  z.object({
    id: z.string(),
    userAgent: z.string().nullable().openapi({
      description:
        "Raw User-Agent captured when this session's current token was issued — the app renders a friendly device/browser label from it.",
    }),
    createdAt: z.string().openapi({
      description:
        'When this session\'s *current* token was issued — it rotates every 15 minutes or so of use, so this reads as "last active", not "first signed in".',
    }),
    isCurrent: z.boolean().openapi({
      description:
        "True for the session this request comes from — matched via the X-Refresh-Token header.",
    }),
  }),
);

export const sessionsListResponseSchema = registry.register(
  "AccountSessionsListResponse",
  z.object({
    sessions: z.array(sessionSchema),
  }),
);

export const sessionIdParamsSchema = z.object({
  sessionId: z.string().uuid(),
});

/** POST /accounts/security/sessions/revoke-others. */
export const revokeOtherSessionsSchema = registry.register(
  "AccountRevokeOtherSessionsRequest",
  z.object({
    currentRefreshToken: z.string().min(1).openapi({
      description: "The caller's own refresh token — identifies which session to keep.",
    }),
  }),
);

/** The emailed staff-invite token, exchanged for a session. Not a login — see accounts.service.ts's redeemInvite. */
export const redeemInviteSchema = registry.register(
  "RedeemInviteRequest",
  z.object({ token: z.string().min(1).max(200) }),
);

export const redeemInviteResponseSchema = registry.register(
  "RedeemInviteResponse",
  z.object({
    accessToken: z.string(),
    refreshToken: z.string(),
    needsSignInMethod: z.boolean().openapi({
      description:
        "True when the member has neither a password nor a linked Google account yet — the welcome screen must not let them leave without one, because the invite is now used up.",
    }),
  }),
);
