import { and, eq, isNull } from "drizzle-orm";
import { db } from "../../db";
import {
  staffUsers,
  staffRoles,
  accountRefreshTokens,
  type StaffUser,
} from "@service-finder/db/schema";
import { NotFoundError, ConflictError, ForbiddenError } from "./staff.errors";
import { isClaimed, sendStaffInvite } from "./staff-invites.service";
import {
  assertCovers,
  authorityOf,
  roleReach,
  type Caller,
} from "../staff-roles/staff-roles.service";

/**
 * The business's team: who is on it, inviting people, changing their
 * name or role, and deactivating them. iGroom's team management without
 * its salon side (no locations, services, commission or performance).
 *
 * Who may do what is two layers. The route's permission (staff.view /
 * staff.manage) gets a caller through the door; staff-roles.service.ts's
 * assertCovers then decides whether *this* member and *that* role are
 * within their reach — so holding staff.manage never lets anyone hand
 * out more than they have themselves.
 */
export { NotFoundError, ConflictError, ForbiddenError } from "./staff.errors";

function toStaffResponse(row: StaffUser, role: { name: string; isSystem: boolean } | null) {
  return {
    id: row.id,
    accountId: row.accountId,
    name: row.name,
    email: row.email,
    roleId: row.roleId,
    roleName: role?.name ?? "",
    /** Holds the business's Owner role — the roster marks owners, and only an owner can change one. */
    isOwner: role?.isSystem === true,
    isActive: row.isActive,
    /** False until they've set themselves up through their invite — the roster shows "Invited" and offers Resend / Copy link. */
    claimed: isClaimed(row),
    mfaEnabled: row.mfaEnabled,
    lastLoginAt: row.lastLoginAt ? row.lastLoginAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

export type StaffMember = ReturnType<typeof toStaffResponse>;

async function requireOwnStaff(accountId: string, staffId: string): Promise<StaffUser> {
  const [row] = await db.$primary
    .select()
    .from(staffUsers)
    .where(and(eq(staffUsers.id, staffId), eq(staffUsers.accountId, accountId)));
  if (!row) throw new NotFoundError("Team member not found");
  return row;
}

async function roleSummary(roleId: string | null) {
  if (!roleId) return null;
  const [row] = await db.$primary
    .select({ name: staffRoles.name, isSystem: staffRoles.isSystem })
    .from(staffRoles)
    .where(eq(staffRoles.id, roleId));
  return row ?? null;
}

/**
 * True only if `staffId` is the business's sole *active* holder of the
 * Owner role. Moving them to another role, or deactivating them, would
 * leave nobody able to manage the team — so both are refused until
 * someone else is an owner too.
 */
async function isLastActiveOwner(accountId: string, staffId: string): Promise<boolean> {
  const holders = await db.$primary
    .select({ id: staffUsers.id })
    .from(staffUsers)
    .innerJoin(staffRoles, eq(staffUsers.roleId, staffRoles.id))
    .where(
      and(
        eq(staffUsers.accountId, accountId),
        eq(staffRoles.isSystem, true),
        eq(staffUsers.isActive, true),
      ),
    );
  return holders.length === 1 && holders[0]?.id === staffId;
}

/** The check every change to a member goes through: they're on this business, and their current role is within the caller's reach. */
async function requireManageableMember(caller: Caller, staffId: string) {
  const member = await requireOwnStaff(caller.accountId, staffId);
  const authority = await authorityOf(caller);
  assertCovers(
    authority,
    await roleReach(caller.accountId, member.roleId),
    `${member.name}'s role has permissions you don't have, so you can't change their account`,
  );
  return { member, authority };
}

/** Settings → Users & roles → Members: everyone on the team, oldest first (the owner who signed up always leads). */
export async function listStaff(accountId: string) {
  const rows = await db
    .select({ staff: staffUsers, roleName: staffRoles.name, roleIsSystem: staffRoles.isSystem })
    .from(staffUsers)
    .leftJoin(staffRoles, eq(staffUsers.roleId, staffRoles.id))
    .where(eq(staffUsers.accountId, accountId))
    .orderBy(staffUsers.createdAt, staffUsers.id);

  return rows.map((r) =>
    toStaffResponse(
      r.staff,
      r.roleName !== null ? { name: r.roleName, isSystem: r.roleIsSystem ?? false } : null,
    ),
  );
}

export interface InviteStaffInput {
  name: string;
  email: string;
  roleId: string;
}

/**
 * "Invite" = create the member's row with no password and no Google
 * identity yet, and email them a single-use link to set one up (see
 * staff-invites.service.ts). The role they're given has to be within
 * the inviter's reach — see assertCovers.
 */
export async function inviteStaff(caller: Caller, input: InviteStaffInput) {
  const email = input.email.trim().toLowerCase();
  assertCovers(
    await authorityOf(caller),
    await roleReach(caller.accountId, input.roleId),
    "You can't give someone a role with permissions you don't have yourself",
  );

  const [existing] = await db.$primary
    .select({ id: staffUsers.id })
    .from(staffUsers)
    .where(eq(staffUsers.email, email));
  if (existing) {
    throw new ConflictError("Someone with this email already has a ServiceFinder business account");
  }

  const [row] = await db
    .insert(staffUsers)
    .values({
      accountId: caller.accountId,
      name: input.name.trim(),
      email,
      roleId: input.roleId,
    })
    .returning();

  // Never throws for a mail problem — see sendStaffInvite.
  const invite = await sendStaffInvite(row!, caller.id);

  return { staff: toStaffResponse(row!, await roleSummary(row!.roleId)), invite };
}

export interface StaffUpdateInput {
  name?: string;
  roleId?: string;
}

/**
 * Changes a member's name or role. Nobody changes their own role (an
 * owner who wants out hands the Owner role to someone else, who then
 * moves them); the last active owner can't be moved off it; and both the
 * member's current role and the new one have to be within the caller's
 * reach.
 */
export async function updateStaff(caller: Caller, staffId: string, patch: StaffUpdateInput) {
  const { member, authority } = await requireManageableMember(caller, staffId);

  if (patch.roleId !== undefined && patch.roleId !== member.roleId) {
    if (staffId === caller.id) {
      throw new ForbiddenError("You can't change your own role");
    }
    assertCovers(
      authority,
      await roleReach(caller.accountId, patch.roleId),
      "You can't give someone a role with permissions you don't have yourself",
    );
    if (await isLastActiveOwner(caller.accountId, staffId)) {
      throw new ForbiddenError(
        "Make someone else an owner first — every business needs at least one",
      );
    }
  }

  const [row] = await db
    .update(staffUsers)
    .set({
      name: patch.name?.trim() || member.name,
      roleId: patch.roleId ?? member.roleId,
      updatedAt: new Date(),
    })
    .where(eq(staffUsers.id, staffId))
    .returning();

  return toStaffResponse(row!, await roleSummary(row!.roleId));
}

/**
 * Deactivates or reactivates a member. Deactivated, they're refused at
 * sign-in (login(), loginWithGoogle() and refresh all check), every
 * session of theirs is ended now rather than when its refresh token
 * would have run out, and requireAccountAuth turns their very next
 * request away — the cache it reads is dropped by this change.
 *
 * Nobody deactivates themselves, and the last active owner can't be.
 */
export async function setStaffActive(caller: Caller, staffId: string, isActive: boolean) {
  if (staffId === caller.id && !isActive) {
    throw new ForbiddenError("You can't deactivate your own account");
  }
  const { member } = await requireManageableMember(caller, staffId);
  if (!isActive && (await isLastActiveOwner(caller.accountId, staffId))) {
    throw new ForbiddenError("Every business needs at least one active owner");
  }

  const row = await db.$primary.transaction(async (tx) => {
    const [updated] = await tx
      .update(staffUsers)
      .set({ isActive, updatedAt: new Date() })
      .where(eq(staffUsers.id, member.id))
      .returning();
    if (!isActive) {
      await tx
        .update(accountRefreshTokens)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(accountRefreshTokens.staffUserId, member.id),
            isNull(accountRefreshTokens.revokedAt),
          ),
        );
    }
    return updated!;
  });

  return toStaffResponse(row, await roleSummary(row.roleId));
}
