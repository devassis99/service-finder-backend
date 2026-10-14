import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import {
  boUsers,
  boRefreshTokens,
  boRoles,
  boPermissions,
  boRolePermissions,
  type BoUser,
} from "@service-finder/db/schema";
import { verifyGoogleIdToken } from "./google";
import { signAccessToken, signMfaFlowToken, verifyToken } from "./jwt";
import {
  buildOtpAuthUrl,
  decryptMfaSecret,
  encryptMfaSecret,
  generateQrCodeDataUrl,
  generateTotpSecret,
  verifyTotpCode,
} from "./mfa";
import { codeMessage, mfaCodeLimits, takeAttempt } from "../../shared/rate-limit";

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

/** Logged in, but the role doesn't have the required permission. */
export class ForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ForbiddenError";
  }
}

/** A uniqueness constraint this domain cares about was violated (e.g. inviting an already-registered email). */
export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConflictError";
  }
}

/**
 * A row this module was asked about doesn't exist. Each module declares
 * its own error classes rather than importing another's — see
 * shared/middlewares/error-handler.ts for how they're mapped to statuses.
 */
export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}

const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

async function issueSession(user: BoUser) {
  const accessToken = signAccessToken(user.id, user.roleId);

  const refreshToken = crypto.randomBytes(32).toString("hex");
  await db.insert(boRefreshTokens).values({
    userId: user.id,
    tokenHash: hashToken(refreshToken),
    expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
  });

  return { accessToken, refreshToken };
}

export type LoginOutcome =
  | { status: "mfa_setup_required"; setupToken: string }
  | { status: "mfa_challenge_required"; challengeToken: string };

/**
 * Step 1 of login: verify the Google ID token, then find the matching
 * bo_users row. This never creates a user — only a pre-provisioned row
 * (from the seed script, or later an "invite" flow run by a super admin)
 * can ever log in. First login for that email claims the row by
 * stamping its Google account id (googleSub) onto it permanently.
 */
export async function loginWithGoogle(idToken: string): Promise<LoginOutcome> {
  let identity;
  try {
    identity = await verifyGoogleIdToken(idToken);
  } catch (error) {
    // A token Google's library refuses — malformed, expired, issued for
    // another client, forged — is the caller's problem and a 401, not a
    // 500: google-auth-library throws a plain Error for all of those,
    // which the error handler would otherwise report as our own fault.
    // Failing to fetch Google's signing keys at all *is* ours, and stays
    // a 500.
    if (error instanceof Error && /verification certificates/i.test(error.message)) throw error;
    throw new AuthError("Google sign-in could not be verified — please try again");
  }

  if (!identity.emailVerified) {
    throw new AuthError("Google account email is not verified");
  }

  let [user] = await db.$primary
    .select()
    .from(boUsers)
    .where(eq(boUsers.googleSub, identity.googleSub));

  if (!user) {
    const [pending] = await db.$primary
      .select()
      .from(boUsers)
      .where(eq(boUsers.email, identity.email));

    if (!pending) {
      throw new AuthError("No back-office account exists for this Google account");
    }
    if (pending.googleSub) {
      // Already claimed by a *different* Google account than this one —
      // refuse rather than silently re-binding.
      throw new AuthError("This account is already linked to a different Google sign-in");
    }

    [user] = await db
      .update(boUsers)
      .set({ googleSub: identity.googleSub, lastLoginAt: new Date() })
      .where(eq(boUsers.id, pending.id))
      .returning();
  } else {
    await db.update(boUsers).set({ lastLoginAt: new Date() }).where(eq(boUsers.id, user.id));
  }

  if (!user || !user.isActive) {
    throw new AuthError("This account has been deactivated");
  }

  if (!user.mfaEnabled) {
    return { status: "mfa_setup_required", setupToken: signMfaFlowToken(user.id, "mfa_setup") };
  }

  return {
    status: "mfa_challenge_required",
    challengeToken: signMfaFlowToken(user.id, "mfa_challenge"),
  };
}

function verifyFlowToken(token: string, purpose: "mfa_setup" | "mfa_challenge") {
  let payload;
  try {
    payload = verifyToken(token);
  } catch {
    throw new AuthError("Invalid or expired token");
  }
  if (payload.purpose !== purpose) {
    throw new AuthError("Invalid or expired token");
  }
  return payload;
}

/** Step 2a (first login only): generate a TOTP secret + QR code for the user to enroll. */
export async function beginMfaSetup(setupToken: string) {
  const payload = verifyFlowToken(setupToken, "mfa_setup");

  const [user] = await db.$primary.select().from(boUsers).where(eq(boUsers.id, payload.sub));
  if (!user) throw new AuthError("Account not found");
  if (user.mfaEnabled) throw new AuthError("MFA is already enabled for this account");

  const secret = generateTotpSecret();
  await db
    .update(boUsers)
    .set({ mfaSecret: encryptMfaSecret(secret) })
    .where(eq(boUsers.id, user.id));

  const otpAuthUrl = await buildOtpAuthUrl(user.email, secret);
  const qrCodeDataUrl = await generateQrCodeDataUrl(otpAuthUrl);
  return { otpAuthUrl, qrCodeDataUrl };
}

/** Step 2b (first login only): confirm the user's authenticator app is working, then enable MFA and log them in. */
export async function completeMfaSetup(setupToken: string, code: string) {
  const payload = verifyFlowToken(setupToken, "mfa_setup");

  const [user] = await db.$primary.select().from(boUsers).where(eq(boUsers.id, payload.sub));
  if (!user?.mfaSecret) {
    throw new AuthError("MFA setup was not started for this account");
  }

  const secret = decryptMfaSecret(user.mfaSecret);
  if (!(await verifyTotpCode(secret, code))) {
    throw new AuthError("Invalid authentication code");
  }

  const [updated] = await db
    .update(boUsers)
    .set({ mfaEnabled: true, mfaVerifiedAt: new Date() })
    .where(eq(boUsers.id, user.id))
    .returning();

  return issueSession(updated);
}

/** Step 2 (every subsequent login): the account already has MFA — just check the code. */
export async function verifyMfaChallenge(challengeToken: string, code: string) {
  const payload = verifyFlowToken(challengeToken, "mfa_challenge");

  const [user] = await db.$primary.select().from(boUsers).where(eq(boUsers.id, payload.sub));
  if (!user?.mfaSecret) {
    throw new AuthError("MFA is not set up for this account");
  }

  // Counted before the code is checked, per account across every
  // challenge token — see shared/rate-limit.ts's mfaCodeLimits.
  const attempt = await takeAttempt(mfaCodeLimits("bo", user.id), codeMessage);
  const secret = decryptMfaSecret(user.mfaSecret);
  if (!(await verifyTotpCode(secret, code))) {
    throw new AuthError("Invalid authentication code");
  }
  await attempt.succeeded();

  return issueSession(user);
}

/**
 * Lets an already-logged-in user re-enroll MFA from scratch — e.g. they
 * got a new phone and lost their authenticator app. Requires their
 * *current* TOTP code first, proving they still control the existing
 * authenticator before anything changes (same spirit as re-entering
 * your password to change account security settings).
 *
 * On success: clears the current secret and flips mfaEnabled back to
 * false, then issues a fresh mfa_setup flow token — the exact same
 * token type loginWithGoogle issues for a brand-new user, so the
 * frontend can walk them through beginMfaSetup/completeMfaSetup again
 * unchanged (see MfaSetupPage.tsx).
 *
 * This is safe even if the user abandons the reset mid-flow: their
 * current access/refresh tokens keep working exactly as before (session
 * validity never checks mfaEnabled — see requireAuth/refreshSession), so
 * there's no risk of locking anyone out. The only consequence of
 * abandoning is that their *next* fresh Google sign-in (e.g. after
 * logging out, or on a new device) walks them through MFA setup again,
 * same as it would for a never-yet-enrolled invited user.
 *
 * currentCode is only required when there's an active secret to prove
 * control of — an account that's already mid-reset (a previous call
 * already cleared mfaSecret, and setup was never finished) has nothing
 * left to check a code against, so an already-authenticated request can
 * go straight through to a fresh setup token instead of getting stuck.
 */
export async function requestMfaReset(userId: string, currentCode?: string) {
  const [user] = await db.$primary.select().from(boUsers).where(eq(boUsers.id, userId));
  if (!user) {
    throw new AuthError("Account not found");
  }

  if (user.mfaSecret) {
    if (!currentCode) {
      throw new AuthError("Current authentication code is required");
    }
    const secret = decryptMfaSecret(user.mfaSecret);
    if (!(await verifyTotpCode(secret, currentCode))) {
      throw new AuthError("Invalid authentication code");
    }
  }

  await db
    .update(boUsers)
    .set({ mfaEnabled: false, mfaSecret: null, mfaVerifiedAt: null })
    .where(eq(boUsers.id, userId));

  return { setupToken: signMfaFlowToken(userId, "mfa_setup") };
}

/** Rotates a refresh token: the presented one is revoked, a new one is issued, on every use. */
export async function refreshSession(refreshToken: string) {
  const tokenHash = hashToken(refreshToken);
  const [stored] = await db.$primary
    .select()
    .from(boRefreshTokens)
    .where(eq(boRefreshTokens.tokenHash, tokenHash));

  if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
    throw new AuthError("Refresh token is invalid or expired");
  }

  await db
    .update(boRefreshTokens)
    .set({ revokedAt: new Date() })
    .where(eq(boRefreshTokens.id, stored.id));

  const [user] = await db.$primary.select().from(boUsers).where(eq(boUsers.id, stored.userId));
  if (!user?.isActive) {
    throw new AuthError("Account is no longer active");
  }

  return issueSession(user);
}

export async function logout(refreshToken: string) {
  const tokenHash = hashToken(refreshToken);
  await db
    .update(boRefreshTokens)
    .set({ revokedAt: new Date() })
    .where(eq(boRefreshTokens.tokenHash, tokenHash));
}

export async function getUserById(userId: string) {
  const [user] = await db.select().from(boUsers).where(eq(boUsers.id, userId));
  return user;
}

/** Permission keys granted to a role, via bo_role_permissions -> bo_permissions. Used by requirePermission on every gated request. */
export async function getRolePermissionKeys(roleId: string): Promise<string[]> {
  const rows = await db
    .select({ key: boPermissions.key })
    .from(boRolePermissions)
    .innerJoin(boPermissions, eq(boRolePermissions.permissionId, boPermissions.id))
    .where(eq(boRolePermissions.roleId, roleId));
  return rows.map((row) => row.key);
}

/**
 * Everything GET /auth/me needs: the user, their role, and their role's
 * permission keys — the frontend's source of truth for what to show.
 * Deliberately returns a trimmed-down `user` (id/roleId/email/mfaEnabled
 * only), not the raw bo_users row — that row also carries mfaSecret
 * (encrypted, but still not something to ever put on the wire) and other
 * internal fields with no reason to leave the server.
 */
export async function getMeDetails(userId: string) {
  const user = await getUserById(userId);
  if (!user) return null;

  const [role] = await db.select().from(boRoles).where(eq(boRoles.id, user.roleId));
  const permissions = await getRolePermissionKeys(user.roleId);

  return {
    user: { id: user.id, roleId: user.roleId, email: user.email, mfaEnabled: user.mfaEnabled },
    role: role ? { id: role.id, name: role.name } : null,
    permissions,
  };
}
