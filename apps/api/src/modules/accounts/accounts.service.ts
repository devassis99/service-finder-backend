import crypto from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "../../db";
import {
  accounts,
  staffUsers,
  staffRoles,
  accountRefreshTokens,
  type Account,
  type StaffUser,
} from "@service-finder/db/schema";
import { verifyGoogleIdToken, type GoogleIdentity } from "../auth/google";
import { signAccountAccessToken, signMfaChallengeToken } from "./jwt";
import { hashPassword, verifyPassword } from "./password";
import {
  seedDefaultRolesForAccount,
  getStaffRolePermissionKeys,
} from "../staff-roles/staff-roles.service";
import { redeemStaffInvite } from "../staff-users/staff-invites.service";

/**
 * The business app's identity: a business (accounts) and the people who
 * sign in to it (staff_users) — sign-up, sign-in by password or Google,
 * refresh, sign-out, and who-am-I. iGroom's design, carried across
 * without iGroom's salon side: no locations, no plan or checkout step in
 * sign-up. Two-factor, password changes and sessions are in
 * security.service.ts; the team and its roles in modules/staff-users and
 * modules/staff-roles.
 *
 * Errors are this module's own (see shared/middlewares/error-handler.ts).
 */
export class AuthError extends Error {
  /**
   * Machine-readable marker, set only to "TOKEN_INVALID" and only by
   * require-account-auth.middleware.ts — for the cases where the bearer
   * token itself is the problem (missing, unverifiable, or its member no
   * longer active). Every other AuthError here (wrong password, wrong
   * 2FA code, a used-up reset code) leaves it unset.
   *
   * The business app's http.ts reads it to decide whether a 401 is worth
   * a silent refresh-and-retry. Without it a mistyped authenticator code
   * (also a 401) would trigger a refresh, retry with the same wrong
   * code, fail again — and that second failure reads as "the session is
   * dead", logging the person out over a typo.
   */
  readonly code?: "TOKEN_INVALID";

  constructor(message: string, code?: "TOKEN_INVALID") {
    super(message);
    this.name = "AuthError";
    this.code = code;
  }
}

/** A uniqueness rule this domain cares about was broken (e.g. signing up with an email that already signs in somewhere). */
export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConflictError";
  }
}

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}

const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/**
 * The real session: a 15-minute access token and a 30-day, single-use
 * refresh token (only its sha256 is stored). Exported so
 * security.service.ts's confirmMfaLoginChallenge can issue one once the
 * authenticator code checks out — login() and loginWithGoogle() come
 * straight here only for someone without two-factor.
 *
 * `userAgent` is kept on the row only so the Security page's "Active
 * sessions" list has something human to show.
 */
export async function issueSession(
  staffUser: Pick<StaffUser, "id" | "accountId">,
  userAgent?: string,
) {
  const accessToken = signAccountAccessToken(staffUser.id, staffUser.accountId);

  const refreshToken = crypto.randomBytes(32).toString("hex");
  await db.insert(accountRefreshTokens).values({
    staffUserId: staffUser.id,
    tokenHash: hashToken(refreshToken),
    expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
    userAgent: userAgent ?? null,
  });

  return { accessToken, refreshToken };
}

/**
 * Google's verdict on an ID token, with Google's own failures sorted
 * into ours and the caller's — the back office's rule (auth.service.ts),
 * applied here too. A token Google's library refuses (malformed,
 * expired, issued for another client, forged) is a 401; failing to fetch
 * Google's signing keys at all is ours, and stays a 500.
 */
async function verifyGoogle(idToken: string): Promise<GoogleIdentity> {
  let identity: GoogleIdentity;
  try {
    identity = await verifyGoogleIdToken(idToken);
  } catch (error) {
    if (error instanceof Error && /verification certificates/i.test(error.message)) throw error;
    throw new AuthError("Google sign-in could not be verified — please try again");
  }
  if (!identity.emailVerified) {
    throw new AuthError("Google account email is not verified");
  }
  return { ...identity, email: identity.email.trim().toLowerCase() };
}

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "")
    .slice(0, 60)
    .replace(/-$/, "");
  return base || "business";
}

/**
 * A slug nobody else has: the name's own, or that plus a short random
 * suffix. A handful of tries is plenty — a collision on a 6-hex-digit
 * suffix after a collision on the plain name is vanishingly rare, and
 * the unique index is the real guarantee either way.
 */
async function uniqueSlug(name: string): Promise<string> {
  const base = slugify(name);
  let candidate = base;
  for (let attempt = 0; attempt < 5; attempt++) {
    // oxlint-disable-next-line no-await-in-loop -- each try depends on the last one's answer
    const [existing] = await db.$primary
      .select({ id: accounts.id })
      .from(accounts)
      .where(eq(accounts.slug, candidate));
    if (!existing) return candidate;
    candidate = `${base}-${crypto.randomBytes(3).toString("hex")}`;
  }
  throw new ConflictError(
    "Could not generate a unique address for this business — try a different name",
  );
}

export interface SignupInput {
  fullName: string;
  workEmail: string;
  password?: string;
  googleIdToken?: string;
  businessName: string;
  phone?: string;
}

/**
 * Creates a business, its default roles and the owner who signed up for
 * it — in one transaction, so a failure partway through never leaves a
 * business with nobody able to sign in to it.
 *
 * Sign-in is by password, Google, or both: with a Google ID token, its
 * (verified) email has to be the work email given, and the Google
 * identity is bound to the owner from the start.
 */
export async function signup(input: SignupInput, userAgent?: string) {
  if (!input.password && !input.googleIdToken) {
    throw new AuthError("Either a password or a Google ID token is required");
  }
  const email = input.workEmail.trim().toLowerCase();

  let googleSub: string | undefined;
  if (input.googleIdToken) {
    const identity = await verifyGoogle(input.googleIdToken);
    if (identity.email !== email) {
      throw new AuthError("Google account email does not match the work email provided");
    }
    googleSub = identity.googleSub;
  }

  const [existingByEmail] = await db.$primary
    .select({ id: staffUsers.id })
    .from(staffUsers)
    .where(eq(staffUsers.email, email));
  if (existingByEmail) {
    throw new ConflictError("An account already exists for this email — sign in instead");
  }

  if (googleSub) {
    const [existingByGoogle] = await db.$primary
      .select({ id: staffUsers.id })
      .from(staffUsers)
      .where(eq(staffUsers.googleSub, googleSub));
    if (existingByGoogle) {
      throw new ConflictError("This Google account is already linked to another sign-in");
    }
  }

  const passwordHash = input.password ? await hashPassword(input.password) : undefined;
  const slug = await uniqueSlug(input.businessName);

  const owner = await db.$primary.transaction(async (tx) => {
    const [account] = await tx
      .insert(accounts)
      .values({
        name: input.businessName.trim(),
        slug,
        email,
        phone: input.phone?.trim() || null,
      })
      .returning();

    const ownerRoleId = await seedDefaultRolesForAccount(tx, account!.id);

    const [staffUser] = await tx
      .insert(staffUsers)
      .values({
        accountId: account!.id,
        name: input.fullName.trim(),
        email,
        passwordHash,
        googleSub,
        roleId: ownerRoleId,
        lastLoginAt: new Date(),
      })
      .returning();

    return staffUser!;
  });

  return issueSession(owner, userAgent);
}

export type LoginOutcome =
  | { status: "ok"; accessToken: string; refreshToken: string }
  | { status: "mfa_challenge_required"; challengeToken: string };

/**
 * The end of a successful first factor. Someone with two-factor gets a
 * 5-minute challenge token and has to finish with their authenticator
 * (security.service.ts's confirmMfaLoginChallenge, which is also where
 * lastLoginAt is stamped for them — it records a *completed* sign-in).
 */
async function finishFirstFactor(staffUser: StaffUser, userAgent?: string): Promise<LoginOutcome> {
  if (staffUser.mfaEnabled) {
    return {
      status: "mfa_challenge_required",
      challengeToken: signMfaChallengeToken(staffUser.id),
    };
  }

  await db
    .update(staffUsers)
    .set({ lastLoginAt: new Date() })
    .where(eq(staffUsers.id, staffUser.id));
  const { accessToken, refreshToken } = await issueSession(staffUser, userAgent);
  return { status: "ok", accessToken, refreshToken };
}

export async function login(
  email: string,
  password: string,
  userAgent?: string,
): Promise<LoginOutcome> {
  const [staffUser] = await db.$primary
    .select()
    .from(staffUsers)
    .where(eq(staffUsers.email, email.trim().toLowerCase()));
  if (!staffUser?.passwordHash || !(await verifyPassword(password, staffUser.passwordHash))) {
    throw new AuthError("Invalid email or password");
  }
  if (!staffUser.isActive) {
    throw new AuthError("This account has been deactivated");
  }
  return finishFirstFactor(staffUser, userAgent);
}

export type GoogleLoginOutcome =
  | LoginOutcome
  | { status: "no_account"; email: string; name?: string };

/**
 * Unlike the back office's invite-only Google sign-in, an unknown Google
 * identity is a normal case here — anyone can sign their business up —
 * so it comes back as "no_account" rather than an error, and the app
 * carries the visitor on into sign-up with the same ID token.
 *
 * A Google identity matching nobody's googleSub but somebody's email
 * links itself to that row: a password member adding Google as a second
 * way in, or an invited member choosing Google on the welcome screen.
 * A row already bound to a different Google identity is refused rather
 * than re-bound.
 */
export async function loginWithGoogle(
  idToken: string,
  userAgent?: string,
): Promise<GoogleLoginOutcome> {
  const identity = await verifyGoogle(idToken);

  let [staffUser] = await db.$primary
    .select()
    .from(staffUsers)
    .where(eq(staffUsers.googleSub, identity.googleSub));

  if (!staffUser) {
    const [pending] = await db.$primary
      .select()
      .from(staffUsers)
      .where(eq(staffUsers.email, identity.email));

    if (!pending) {
      return { status: "no_account", email: identity.email, name: identity.name };
    }
    if (pending.googleSub) {
      throw new AuthError("This account is already linked to a different Google sign-in");
    }
    if (!pending.isActive) {
      throw new AuthError("This account has been deactivated");
    }

    [staffUser] = await db
      .update(staffUsers)
      .set({ googleSub: identity.googleSub, updatedAt: new Date() })
      .where(and(eq(staffUsers.id, pending.id), isNull(staffUsers.googleSub)))
      .returning();
    if (!staffUser) {
      // Lost a race with another request linking a Google identity to
      // this same row — whichever got there first stands.
      throw new AuthError("This account is already linked to a different Google sign-in");
    }
  }

  if (!staffUser.isActive) {
    throw new AuthError("This account has been deactivated");
  }
  return finishFirstFactor(staffUser, userAgent);
}

/**
 * Trades a refresh token for a new pair, retiring the old one.
 *
 * The retirement is one conditional UPDATE — matching only a row that is
 * still unrevoked and unexpired — rather than a read followed by a
 * write, so two requests racing with the same token can't both win: one
 * gets the row, the other gets nothing and a 401. (Two tabs refreshing
 * together is the everyday case; a stolen token being replayed is the
 * case it matters for.)
 */
export async function refreshSession(refreshToken: string, userAgent?: string) {
  const [stored] = await db
    .update(accountRefreshTokens)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(accountRefreshTokens.tokenHash, hashToken(refreshToken)),
        isNull(accountRefreshTokens.revokedAt),
        gt(accountRefreshTokens.expiresAt, new Date()),
      ),
    )
    .returning();

  if (!stored) {
    throw new AuthError("Refresh token is invalid or expired");
  }

  const [staffUser] = await db.$primary
    .select()
    .from(staffUsers)
    .where(eq(staffUsers.id, stored.staffUserId));
  if (!staffUser?.isActive) {
    throw new AuthError("This account is no longer active");
  }

  return issueSession(staffUser, userAgent);
}

export async function logout(refreshToken: string) {
  await db
    .update(accountRefreshTokens)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(accountRefreshTokens.tokenHash, hashToken(refreshToken)),
        isNull(accountRefreshTokens.revokedAt),
      ),
    );
}

/** Read from the primary: every caller of this is about to make a decision on the row (sign someone in, check their 2FA, authorize a request). */
export async function getStaffUserById(staffUserId: string) {
  const [staffUser] = await db.$primary
    .select()
    .from(staffUsers)
    .where(eq(staffUsers.id, staffUserId));
  return staffUser;
}

function toAccountResponse(account: Account) {
  return {
    id: account.id,
    name: account.name,
    slug: account.slug,
    email: account.email,
    phone: account.phone,
    createdAt: account.createdAt.toISOString(),
  };
}

/**
 * Everything GET /accounts/me needs: the caller (never their password
 * hash, Google id or 2FA secret — only the facts the app needs about
 * them: hasPassword, hasGoogle, mfaEnabled), the permission keys their
 * role grants, and their business.
 */
export async function getMeDetails(staffUserId: string) {
  const staffUser = await getStaffUserById(staffUserId);
  if (!staffUser) return null;

  const [[account], [role], permissions] = await Promise.all([
    db.$primary.select().from(accounts).where(eq(accounts.id, staffUser.accountId)),
    staffUser.roleId
      ? db.$primary
          .select({ name: staffRoles.name, isSystem: staffRoles.isSystem })
          .from(staffRoles)
          .where(eq(staffRoles.id, staffUser.roleId))
      : Promise.resolve([]),
    getStaffRolePermissionKeys(staffUser.roleId),
  ]);
  if (!account) return null;

  return {
    staffUser: {
      id: staffUser.id,
      accountId: staffUser.accountId,
      name: staffUser.name,
      email: staffUser.email,
      roleId: staffUser.roleId,
      roleName: role?.name ?? "",
      isOwner: role?.isSystem === true,
      hasPassword: staffUser.passwordHash !== null,
      hasGoogle: staffUser.googleSub !== null,
      mfaEnabled: staffUser.mfaEnabled,
      lastLoginAt: staffUser.lastLoginAt ? staffUser.lastLoginAt.toISOString() : null,
      createdAt: staffUser.createdAt.toISOString(),
    },
    permissions,
    account: toAccountResponse(account),
  };
}

/**
 * The caller changing their *own* name — open to any signed-in member.
 * Distinct from staff.service.ts's updateStaff, which needs staff.manage
 * and can also change someone's role.
 */
export async function updateOwnProfile(staffUserId: string, patch: { name: string }) {
  const [row] = await db
    .update(staffUsers)
    .set({ name: patch.name.trim(), updatedAt: new Date() })
    .where(eq(staffUsers.id, staffUserId))
    .returning({ id: staffUsers.id });
  if (!row) throw new AuthError("Account not found");
  return getMeDetails(staffUserId);
}

export interface UpdateBusinessInput {
  name?: string;
  email?: string;
  phone?: string | null;
}

/**
 * Settings → Business. The slug is deliberately not among the fields:
 * it is the business's address, fixed at sign-up, and a renamed
 * business keeping its old links working matters more than the slug
 * matching the new name.
 */
export async function updateBusiness(accountId: string, patch: UpdateBusinessInput) {
  const [row] = await db
    .update(accounts)
    .set({
      ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
      ...(patch.email !== undefined ? { email: patch.email.trim().toLowerCase() } : {}),
      ...(patch.phone !== undefined ? { phone: patch.phone?.trim() || null } : {}),
      updatedAt: new Date(),
    })
    .where(eq(accounts.id, accountId))
    .returning();
  if (!row) throw new NotFoundError("Business not found");
  return toAccountResponse(row);
}

/**
 * Exchanges an emailed staff-invite token for a real session.
 *
 * Unauthenticated by nature — this *is* the authentication. The token is
 * single-use and time-limited (staff-invites.service.ts), and the row it
 * points at is one somebody with staff.manage deliberately created.
 *
 * Returns `needsSignInMethod` so the app insists on a password or a
 * linked Google account before letting them leave the welcome screen:
 * the invite has just been used up, and someone who leaves with neither
 * has no way back in.
 */
export async function redeemInvite(token: string, userAgent?: string) {
  const { staffUser, needsSignInMethod } = await redeemStaffInvite(token);
  // lastLoginAt is left alone: it is one of the three things that mark a
  // member as having claimed their account (see staff.service.ts's
  // isClaimed), and somebody who opens the link and closes the tab
  // before choosing a way to sign in hasn't — they still need "Resend".
  const session = await issueSession(staffUser, userAgent);
  return { ...session, needsSignInMethod };
}
