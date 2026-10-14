import { eq } from "drizzle-orm";
import { db } from "../../db";
import { boUsers, boRoles, type BoUser } from "@service-finder/db/schema";
import { ConflictError, ForbiddenError, NotFoundError } from "../auth";

export interface BoUserView {
  id: string;
  name: string;
  email: string;
  roleId: string;
  roleName: string;
  isActive: boolean;
  mfaEnabled: boolean;
  /** Has this invite been accepted — i.e. has googleSub been bound by a first sign-in? */
  claimed: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

function toView(user: BoUser, roleName: string): BoUserView {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    roleId: user.roleId,
    roleName,
    isActive: user.isActive,
    mfaEnabled: user.mfaEnabled,
    claimed: user.googleSub !== null,
    lastLoginAt: user.lastLoginAt ? user.lastLoginAt.toISOString() : null,
    createdAt: user.createdAt.toISOString(),
  };
}

/** Every back-office user (invited or claimed, active or deactivated), newest first, with its role name resolved. */
export async function listUsers(): Promise<BoUserView[]> {
  const rows = await db
    .select({ user: boUsers, roleName: boRoles.name })
    .from(boUsers)
    .innerJoin(boRoles, eq(boUsers.roleId, boRoles.id))
    .orderBy(boUsers.createdAt);

  return rows.map((row) => toView(row.user, row.roleName));
}

export interface InviteUserInput {
  email: string;
  name: string;
  roleId: string;
}

/**
 * "Invite" = pre-provision a bo_users row with no Google account bound
 * yet (googleSub stays null), exactly like auth.seed.ts does for the
 * initial super admin. The first Google sign-in matching this exact
 * email claims the row and is automatically routed into mandatory MFA
 * setup by loginWithGoogle() (in the auth module) — nothing else has
 * to happen here to make that work.
 *
 * Nothing is emailed yet — whoever invites someone tells them
 * out-of-band which Google account to sign in with, same as iGroom's
 * back office. shared/email.ts (sendEmail + renderEmail) is the piece to
 * call here once there's a back-office URL in config to link to.
 */
export async function inviteUser(input: InviteUserInput): Promise<BoUserView> {
  const [role] = await db.select().from(boRoles).where(eq(boRoles.id, input.roleId));
  if (!role) throw new NotFoundError("Role not found");

  const [existing] = await db.select().from(boUsers).where(eq(boUsers.email, input.email));
  if (existing) throw new ConflictError("A back-office user with this email already exists");

  const [user] = await db
    .insert(boUsers)
    .values({ roleId: input.roleId, name: input.name, email: input.email })
    .returning();

  return toView(user, role.name);
}

async function getUserOrThrow(userId: string): Promise<BoUser> {
  const [user] = await db.select().from(boUsers).where(eq(boUsers.id, userId));
  if (!user) throw new NotFoundError("User not found");
  return user;
}

/**
 * Reassigns a user's role. A user can't change their own role — even a
 * superadmin — so nobody can accidentally strip their own access with
 * no one else able to fix it via the UI.
 */
export async function updateUserRole(
  userId: string,
  roleId: string,
  requestingUserId: string,
): Promise<BoUserView> {
  if (userId === requestingUserId) {
    throw new ForbiddenError("You can't change your own role");
  }

  const [role] = await db.select().from(boRoles).where(eq(boRoles.id, roleId));
  if (!role) throw new NotFoundError("Role not found");

  await getUserOrThrow(userId);

  const [updated] = await db
    .update(boUsers)
    .set({ roleId })
    .where(eq(boUsers.id, userId))
    .returning();

  return toView(updated, role.name);
}

/**
 * Activates/deactivates a user. A deactivated user is rejected at
 * login (see loginWithGoogle) and, since permissions are looked up
 * fresh per request, an active session's next call also starts
 * failing as soon as isActive flips to false. A user can't deactivate
 * themselves, for the same self-lockout reason as updateUserRole.
 */
export async function setUserActive(
  userId: string,
  isActive: boolean,
  requestingUserId: string,
): Promise<BoUserView> {
  if (userId === requestingUserId && !isActive) {
    throw new ForbiddenError("You can't deactivate your own account");
  }

  const user = await getUserOrThrow(userId);

  const [role] = await db.select().from(boRoles).where(eq(boRoles.id, user.roleId));
  if (!role) throw new NotFoundError("Role not found");

  const [updated] = await db
    .update(boUsers)
    .set({ isActive })
    .where(eq(boUsers.id, userId))
    .returning();

  return toView(updated, role.name);
}
