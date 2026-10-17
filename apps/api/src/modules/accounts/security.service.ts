import crypto from "node:crypto";
import { and, desc, eq, gt, isNull, ne, sql } from "drizzle-orm";
import { db } from "../../db";
import {
  staffUsers,
  staffPasswordResetCodes,
  accountRefreshTokens,
} from "@service-finder/db/schema";
import {
  decryptMfaSecret,
  encryptMfaSecret,
  generateTotpSecret,
  buildOtpAuthUrl,
  generateQrCodeDataUrl,
  verifyTotpCode,
} from "../auth/mfa";
import { verifyMfaChallengeToken } from "./jwt";
import { renderEmail, sendEmail } from "../../shared/email";
import { hashPassword } from "./password";
import {
  AuthError,
  ConflictError,
  NotFoundError,
  getStaffUserById,
  hashToken,
  issueSession,
} from "./accounts.service";
import { codeMessage, mfaCodeLimits, takeAttempt } from "../../shared/rate-limit";

/**
 * The Security settings page and the second step of signing in: set or
 * change a password, turn two-factor on and off, finish an MFA
 * challenge, and see or end your own sessions. iGroom's flows, unchanged
 * in substance.
 */

const RESET_CODE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const RESET_CODE_RESEND_COOLDOWN_MS = 60 * 1000; // 1 minute
const MAX_RESET_CODE_ATTEMPTS = 5;

/** The issuer an authenticator app files a business-app code under — distinct from the back office's, so the two never look alike on someone's phone. */
const TOTP_ISSUER = "ServiceFinder";

function generateSixDigitCode(): string {
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, "0");
}

/** Every security notice here is the same shape: a heading, a sentence, and "if this wasn't you". */
function securityNotice(heading: string, sentence: string): string {
  return renderEmail({
    letterhead: "Business",
    heading,
    paragraphs: [sentence],
    footnote:
      "If this wasn't you, change your password and contact your business's owner straight away.",
  });
}

async function requireStaffUser(staffUserId: string) {
  const staffUser = await getStaffUserById(staffUserId);
  if (!staffUser) throw new NotFoundError("Team member not found");
  return staffUser;
}

/**
 * Set/Change password, step 1, for someone without two-factor: email
 * them a 6-digit code to prove the inbox is theirs. One a minute per
 * person (here) and twenty an hour per device (the controller's
 * emailCodeLimits). Each send is a new row, so a resend can't reset the
 * wrong-guess count on the code before it.
 */
export async function requestPasswordResetCode(staffUserId: string) {
  const staffUser = await requireStaffUser(staffUserId);
  if (staffUser.mfaEnabled) {
    throw new ConflictError(
      "Two-factor authentication is on — verify with your authenticator app instead",
    );
  }

  const [lastCode] = await db.$primary
    .select()
    .from(staffPasswordResetCodes)
    .where(eq(staffPasswordResetCodes.staffUserId, staffUserId))
    .orderBy(desc(staffPasswordResetCodes.createdAt))
    .limit(1);

  if (lastCode && Date.now() - lastCode.createdAt.getTime() < RESET_CODE_RESEND_COOLDOWN_MS) {
    throw new ConflictError("Please wait a moment before requesting another code");
  }

  const code = generateSixDigitCode();
  await db.insert(staffPasswordResetCodes).values({
    staffUserId,
    email: staffUser.email,
    codeHash: hashToken(code),
    expiresAt: new Date(Date.now() + RESET_CODE_TTL_MS),
  });

  await sendEmail(
    staffUser.email,
    `Your ServiceFinder verification code: ${code}`,
    renderEmail({
      letterhead: "Business",
      heading: `Your code is ${code}`,
      paragraphs: ["Enter it on the Security page to finish setting your password."],
      footnote: "It expires in 10 minutes. If you didn't ask for it, you can ignore this email.",
    }),
  );
}

/**
 * Checks a code against the newest unconsumed one for this person.
 *
 * Wrong guesses are counted with a conditional increment rather than a
 * read-then-write, and consumption the same way, so two requests racing
 * on one code can neither both succeed nor both escape the count.
 */
async function consumeEmailResetCode(staffUserId: string, code: string) {
  const [pending] = await db.$primary
    .select()
    .from(staffPasswordResetCodes)
    .where(
      and(
        eq(staffPasswordResetCodes.staffUserId, staffUserId),
        isNull(staffPasswordResetCodes.consumedAt),
      ),
    )
    .orderBy(desc(staffPasswordResetCodes.createdAt))
    .limit(1);

  if (!pending || pending.expiresAt < new Date()) {
    throw new AuthError("No pending verification code — request a new one");
  }
  if (pending.attempts >= MAX_RESET_CODE_ATTEMPTS) {
    throw new AuthError("Too many incorrect attempts — request a new code");
  }

  if (hashToken(code) !== pending.codeHash) {
    await db
      .update(staffPasswordResetCodes)
      .set({ attempts: pending.attempts + 1 })
      .where(eq(staffPasswordResetCodes.id, pending.id));
    throw new AuthError("Incorrect code");
  }

  const [consumed] = await db
    .update(staffPasswordResetCodes)
    .set({ consumedAt: new Date() })
    .where(
      and(eq(staffPasswordResetCodes.id, pending.id), isNull(staffPasswordResetCodes.consumedAt)),
    )
    .returning({ id: staffPasswordResetCodes.id });
  if (!consumed) {
    throw new AuthError("That code has already been used — request a new one");
  }
}

export interface ConfirmSetPasswordInput {
  newPassword: string;
  /** Emailed 6-digit code — required unless the caller has two-factor on. */
  code?: string;
  /** 6-digit authenticator code — required when the caller has two-factor on. */
  totpCode?: string;
}

/**
 * Set/Change password, final step: whichever identity check applies
 * (emailed code, or the authenticator for someone with two-factor), then
 * the new password, then a "your password changed" email. The same
 * write whether this is a Google-only member's first password or a
 * change to an existing one.
 *
 * Every *other* session of theirs is ended too: a password change is
 * what someone does when they think somebody else has it, and leaving
 * that somebody signed in would defeat the point. The session making
 * the change survives, identified by `keepRefreshToken`.
 */
export async function confirmSetPassword(
  staffUserId: string,
  input: ConfirmSetPasswordInput,
  keepRefreshToken?: string,
) {
  const staffUser = await requireStaffUser(staffUserId);

  if (staffUser.mfaEnabled) {
    if (!input.totpCode) {
      throw new AuthError("A code from your authenticator app is required");
    }
    if (!staffUser.mfaSecret) {
      // Defensive only — mfaEnabled is never true without a secret.
      throw new AuthError("Two-factor authentication isn't set up correctly — contact support");
    }
    const attempt = await takeAttempt(mfaCodeLimits("staff", staffUser.id), codeMessage);
    const valid = await verifyTotpCode(decryptMfaSecret(staffUser.mfaSecret), input.totpCode);
    if (!valid) throw new AuthError("Incorrect authenticator code");
    await attempt.succeeded();
  } else {
    if (!input.code) {
      throw new AuthError("A verification code is required — request one first");
    }
    await consumeEmailResetCode(staffUserId, input.code);
  }

  const passwordHash = await hashPassword(input.newPassword);
  await db
    .update(staffUsers)
    .set({ passwordHash, updatedAt: new Date() })
    .where(eq(staffUsers.id, staffUserId));

  await revokeSessionsExcept(staffUserId, keepRefreshToken);

  await sendEmail(
    staffUser.email,
    "Your ServiceFinder password was changed",
    securityNotice(
      "Your password was changed",
      "The password for your ServiceFinder business account was just changed, and every other device was signed out.",
    ),
  );
}

/**
 * A first password for someone who has never had one — an invited
 * member on the welcome screen, or a Google-only member.
 *
 * confirmSetPassword always demands a code because it *changes* a
 * credential someone may be relying on. Here there is none to change,
 * and an invited member proved control of the inbox seconds ago by
 * opening the single-use link that minted this session.
 *
 * The `passwordHash === null` guard is what keeps the two apart, and it
 * is not advisory: the moment a password exists this stops working and
 * the coded flow is the only way to change it.
 */
export async function setInitialPassword(staffUserId: string, newPassword: string) {
  const passwordHash = await hashPassword(newPassword);
  const [updated] = await db
    .update(staffUsers)
    .set({
      passwordHash,
      // An invited member's first sign-in is the invite itself, which
      // deliberately leaves lastLoginAt alone (see accounts.service.ts's
      // redeemInvite). Choosing a password is the moment they've truly
      // arrived — so the roster stops saying "Never".
      lastLoginAt: sql`coalesce(${staffUsers.lastLoginAt}, now())`,
      updatedAt: new Date(),
    })
    .where(and(eq(staffUsers.id, staffUserId), isNull(staffUsers.passwordHash)))
    .returning({ email: staffUsers.email });

  if (!updated) {
    const staffUser = await requireStaffUser(staffUserId);
    if (staffUser.passwordHash !== null) {
      throw new ConflictError(
        "This account already has a password — change it from Security settings",
      );
    }
    throw new NotFoundError("Team member not found");
  }

  // Still worth telling them: if this wasn't them, a password just
  // appeared on an account bearing their address.
  await sendEmail(
    updated.email,
    "Your ServiceFinder password is set",
    securityNotice(
      "Your password is set",
      "You can now sign in to ServiceFinder with your email address and this password.",
    ),
  );
}

export interface MfaSetupResult {
  /** Manual-entry fallback for an authenticator app that can't scan the QR code. */
  secret: string;
  /** data: URL PNG — render directly as an <img src>. */
  qrCodeDataUrl: string;
}

/**
 * Two-factor, step 1: a fresh TOTP secret, stored (encrypted) *without*
 * turning two-factor on, and a QR code for an authenticator app. It only
 * turns on once confirmMfaSetup sees a real code from that app, so an
 * abandoned setup leaves it off — and starting again just overwrites the
 * pending secret.
 */
export async function beginMfaSetup(staffUserId: string): Promise<MfaSetupResult> {
  const staffUser = await requireStaffUser(staffUserId);
  if (staffUser.mfaEnabled) {
    throw new ConflictError("Two-factor authentication is already on");
  }

  const secret = generateTotpSecret();
  await db
    .update(staffUsers)
    .set({ mfaSecret: encryptMfaSecret(secret), updatedAt: new Date() })
    .where(eq(staffUsers.id, staffUserId));

  const otpAuthUrl = await buildOtpAuthUrl(staffUser.email, secret, TOTP_ISSUER);
  const qrCodeDataUrl = await generateQrCodeDataUrl(otpAuthUrl);
  return { secret, qrCodeDataUrl };
}

/** Two-factor, step 2: the first live code from the app proves the secret landed; two-factor turns on, and they're told by email. */
export async function confirmMfaSetup(staffUserId: string, code: string) {
  const staffUser = await requireStaffUser(staffUserId);
  if (staffUser.mfaEnabled) {
    throw new ConflictError("Two-factor authentication is already on");
  }
  if (!staffUser.mfaSecret) {
    throw new AuthError("Start setup first — there's no pending authenticator to confirm");
  }

  const attempt = await takeAttempt(mfaCodeLimits("staff", staffUser.id), codeMessage);
  const valid = await verifyTotpCode(decryptMfaSecret(staffUser.mfaSecret), code);
  if (!valid) throw new AuthError("Incorrect authenticator code");
  await attempt.succeeded();

  await db
    .update(staffUsers)
    .set({ mfaEnabled: true, mfaVerifiedAt: new Date(), updatedAt: new Date() })
    .where(eq(staffUsers.id, staffUserId));

  await sendEmail(
    staffUser.email,
    "Two-factor authentication is on",
    securityNotice(
      "Two-factor authentication is on",
      "Signing in to your ServiceFinder business account now also needs a code from your authenticator app.",
    ),
  );
}

/**
 * Turning two-factor off still takes a live code from the app — proof of
 * the device, not just of the open session. No password fallback: a
 * lost phone is a conversation with the business's owner or support.
 */
export async function disableMfa(staffUserId: string, code: string) {
  const staffUser = await requireStaffUser(staffUserId);
  if (!staffUser.mfaEnabled || !staffUser.mfaSecret) {
    throw new ConflictError("Two-factor authentication isn't on");
  }

  const attempt = await takeAttempt(mfaCodeLimits("staff", staffUser.id), codeMessage);
  const valid = await verifyTotpCode(decryptMfaSecret(staffUser.mfaSecret), code);
  if (!valid) throw new AuthError("Incorrect authenticator code");
  await attempt.succeeded();

  await db
    .update(staffUsers)
    .set({ mfaEnabled: false, mfaSecret: null, mfaVerifiedAt: null, updatedAt: new Date() })
    .where(eq(staffUsers.id, staffUserId));

  await sendEmail(
    staffUser.email,
    "Two-factor authentication is off",
    securityNotice(
      "Two-factor authentication is off",
      "Signing in to your ServiceFinder business account no longer asks for an authenticator code.",
    ),
  );
}

/**
 * The second step of signing in for someone with two-factor on:
 * login()/loginWithGoogle() hand back a 5-minute challenge token instead
 * of a session, and this trades it plus a live code for the real thing.
 * lastLoginAt is stamped here, the moment the sign-in actually completes.
 */
export async function confirmMfaLoginChallenge(
  challengeToken: string,
  code: string,
  userAgent?: string,
) {
  let payload;
  try {
    payload = verifyMfaChallengeToken(challengeToken);
  } catch {
    throw new AuthError("Your sign-in expired — sign in again");
  }

  const staffUser = await getStaffUserById(payload.sub);
  if (!staffUser || !staffUser.isActive) {
    throw new AuthError("This account has been deactivated");
  }
  if (!staffUser.mfaEnabled || !staffUser.mfaSecret) {
    // Defensive only — a challenge token is never issued without it.
    throw new AuthError("Two-factor authentication isn't on for this account");
  }

  // Counted before the code is checked, per person across every
  // challenge token — see shared/rate-limit.ts's mfaCodeLimits.
  const attempt = await takeAttempt(mfaCodeLimits("staff", staffUser.id), codeMessage);
  const valid = await verifyTotpCode(decryptMfaSecret(staffUser.mfaSecret), code);
  if (!valid) throw new AuthError("Incorrect authenticator code");
  await attempt.succeeded();

  await db
    .update(staffUsers)
    .set({ lastLoginAt: new Date() })
    .where(eq(staffUsers.id, staffUser.id));

  return issueSession(staffUser, userAgent);
}

export interface SessionSummary {
  id: string;
  userAgent: string | null;
  /** When this session's *current* token was issued — "last active", since a refresh rotates it. */
  createdAt: string;
  isCurrent: boolean;
}

/**
 * Security page's "Active sessions". Every unrevoked, unexpired refresh
 * token *is* one live session, so this lists those rather than keeping a
 * sessions table of its own. The caller's own refresh token, when sent,
 * marks which row is "this device".
 */
export async function listSessions(
  staffUserId: string,
  currentRefreshToken?: string,
): Promise<SessionSummary[]> {
  const rows = await db.$primary
    .select()
    .from(accountRefreshTokens)
    .where(
      and(
        eq(accountRefreshTokens.staffUserId, staffUserId),
        isNull(accountRefreshTokens.revokedAt),
        gt(accountRefreshTokens.expiresAt, new Date()),
      ),
    )
    .orderBy(desc(accountRefreshTokens.createdAt));

  const currentHash = currentRefreshToken ? hashToken(currentRefreshToken) : null;
  return rows.map((row) => ({
    id: row.id,
    userAgent: row.userAgent,
    createdAt: row.createdAt.toISOString(),
    isCurrent: currentHash !== null && row.tokenHash === currentHash,
  }));
}

/**
 * Ends one session by id. Scoped to the caller, so nobody can end
 * someone else's by guessing an id. Ending your *own* current session is
 * allowed — it's just signing out — and the app notices (isCurrent) and
 * clears itself too.
 */
export async function revokeSession(staffUserId: string, sessionId: string) {
  const [row] = await db
    .update(accountRefreshTokens)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(accountRefreshTokens.id, sessionId),
        eq(accountRefreshTokens.staffUserId, staffUserId),
        isNull(accountRefreshTokens.revokedAt),
      ),
    )
    .returning({ id: accountRefreshTokens.id });
  if (!row) {
    throw new NotFoundError("Session not found");
  }
}

/** Every live session of this member's except the one holding `keepRefreshToken` (or every one, without it). */
async function revokeSessionsExcept(staffUserId: string, keepRefreshToken?: string) {
  await db
    .update(accountRefreshTokens)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(accountRefreshTokens.staffUserId, staffUserId),
        isNull(accountRefreshTokens.revokedAt),
        keepRefreshToken
          ? ne(accountRefreshTokens.tokenHash, hashToken(keepRefreshToken))
          : undefined,
      ),
    );
}

/** "Sign out everywhere else" — every other session ends; the one in this browser stays. */
export async function revokeOtherSessions(staffUserId: string, currentRefreshToken: string) {
  await revokeSessionsExcept(staffUserId, currentRefreshToken);
}
