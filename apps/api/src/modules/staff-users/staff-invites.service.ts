import crypto from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "../../db";
import { env } from "../../config/env";
import { accounts, staffInvites, staffUsers, type StaffUser } from "@service-finder/db/schema";
import { renderEmail, sendEmail } from "../../shared/email";
import { NotFoundError, ConflictError } from "./staff.errors";
import {
  assertCovers,
  authorityOf,
  roleReach,
  type Caller,
} from "../staff-roles/staff-roles.service";

/** Seven days — long enough to survive a weekend and a spam folder. */
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** sha256 hex — the token itself is never stored. */
function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function inviteUrl(token: string): string {
  // Fragment, not query string: a fragment is never sent to a server, so
  // the token stays out of access logs, Referer headers and any proxy in
  // between.
  return `${env.TENANT_APP_URL.replace(/\/$/, "")}/invite#${token}`;
}

/**
 * Whether a member has set themselves up: a password, a linked Google
 * account, or a completed sign-in. Until then the roster shows them as
 * "Invited" and offers Resend / Copy link. All three are checked, not
 * just lastLoginAt — a row whose credentials were set some other way
 * (seed data, a script) has still been claimed.
 */
export function isClaimed(member: Pick<StaffUser, "lastLoginAt" | "passwordHash" | "googleSub">) {
  return member.lastLoginAt !== null || member.passwordHash !== null || member.googleSub !== null;
}

/**
 * Retires every outstanding invite for a member — called before minting
 * a new one, so a resend genuinely supersedes: the older email stops
 * working the moment a newer link exists, which is what someone means
 * when they click "Resend" after a link went to the wrong person.
 */
async function revokeOutstandingInvites(staffUserId: string) {
  await db
    .update(staffInvites)
    .set({ revokedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(staffInvites.staffUserId, staffUserId),
        isNull(staffInvites.acceptedAt),
        isNull(staffInvites.revokedAt),
      ),
    );
}

/**
 * Retires any outstanding invite and issues a fresh one. Shared by the
 * two ways a member is handed a way in — an email, and a link to pass on
 * by hand — so they can't drift apart on what matters: revoke first,
 * 32 random bytes, only the hash stored.
 *
 * The raw token exists here and nowhere else, ever. Nothing can read an
 * existing invite's link back out of the database, which is why "copy
 * link" has to mint a new one rather than look one up.
 */
async function mintInvite(staffUserId: string, invitedByStaffUserId: string | null) {
  await revokeOutstandingInvites(staffUserId);

  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS);

  await db.insert(staffInvites).values({
    staffUserId,
    tokenHash: hashToken(token),
    expiresAt,
    invitedByStaffUserId,
  });

  return { token, expiresAt };
}

/**
 * What became of the invite email. Three outcomes, not two: with no
 * RESEND_API_KEY the dev fallback prints the email and returns cleanly,
 * and reporting that as "sent" would have the roster claim an invite
 * arrived when it never left the machine.
 */
export type InviteDelivery = "sent" | "logged" | "failed";

export interface InviteOutcome {
  emailed: boolean;
  delivery: InviteDelivery;
  expiresAt: string;
}

/**
 * Mints a fresh invite and emails it.
 *
 * Never throws for a mail problem: inviteStaff() calls this after the
 * member's row is committed, and a Resend outage (or an unverified
 * sending domain) must not turn a successful invite into a failed
 * request with a half-created member behind it. The failure is logged
 * and reported as delivery "failed", and Resend / Copy link recover it.
 */
export async function sendStaffInvite(
  staffUser: Pick<StaffUser, "id" | "name" | "email" | "accountId">,
  invitedByStaffUserId: string | null,
): Promise<InviteOutcome> {
  const { token, expiresAt } = await mintInvite(staffUser.id, invitedByStaffUserId);

  const [account] = await db
    .select({ name: accounts.name })
    .from(accounts)
    .where(eq(accounts.id, staffUser.accountId));
  const businessName = account?.name ?? "your new team";
  const firstName = staffUser.name.trim().split(/\s+/)[0] || "there";

  const url = inviteUrl(token);
  // Outside production the link is always printed on its own line, not
  // only when something goes wrong: hunting for an href in a wall of
  // table markup is nobody's idea of a local dev loop.
  if (env.NODE_ENV !== "production") {
    console.log(`[invite:dev] ${staffUser.email} -> ${url}`);
  }

  try {
    const outcome = await sendEmail(
      staffUser.email,
      `You've been added to ${businessName} on ServiceFinder`,
      renderEmail({
        letterhead: "Business",
        heading: `${firstName}, you're on the team at ${businessName}`,
        paragraphs: [
          `${businessName} has added you to their ServiceFinder business account.`,
          "Open the link below to set up your sign-in — a password, or your Google account. It takes a minute.",
        ],
        action: { label: "Set up my account", url },
        footnote:
          "This link works once and expires in 7 days. If it's expired, ask whoever invited you to send a new one.",
      }),
    );
    return { emailed: outcome === "sent", delivery: outcome, expiresAt: expiresAt.toISOString() };
  } catch (error) {
    console.error(`Failed to email the invite for staff user ${staffUser.id}`, error);
    return { emailed: false, delivery: "failed", expiresAt: expiresAt.toISOString() };
  }
}

/**
 * The member, if they can still be handed a way in at all — and only if
 * the caller could manage them anyway (a setup link is a way into their
 * account).
 *
 * Somebody who has already set themselves up must not be given a link:
 * it would be a way in past their own password. A deactivated member is
 * refused for the plainer reason that an account they can't use is only
 * confusing.
 */
async function requireInvitableMember(caller: Caller, staffId: string) {
  const [member] = await db.$primary
    .select()
    .from(staffUsers)
    .where(and(eq(staffUsers.id, staffId), eq(staffUsers.accountId, caller.accountId)));
  if (!member) throw new NotFoundError("Team member not found");

  assertCovers(
    await authorityOf(caller),
    await roleReach(caller.accountId, member.roleId),
    `${member.name}'s role has permissions you don't have, so you can't invite them again`,
  );

  if (isClaimed(member)) {
    throw new ConflictError("This member has already set up their account");
  }
  if (!member.isActive) {
    throw new ConflictError("Reactivate this member before inviting them again");
  }
  return member;
}

/** "Resend invite" on a member who hasn't set themselves up yet. */
export async function resendStaffInvite(caller: Caller, staffId: string) {
  const member = await requireInvitableMember(caller, staffId);
  return sendStaffInvite(member, caller.id);
}

/**
 * A setup link to pass on by some other means — a chat message, read
 * out — for when email won't do. Sends nothing: "email them again" and
 * "give me the link" are different intentions.
 *
 * Minting it supersedes the link that was emailed (see mintInvite), and
 * the app says so before anyone clicks.
 */
export async function createStaffInviteLink(
  caller: Caller,
  staffId: string,
): Promise<{ url: string; expiresAt: string }> {
  const member = await requireInvitableMember(caller, staffId);
  const { token, expiresAt } = await mintInvite(member.id, caller.id);
  return { url: inviteUrl(token), expiresAt: expiresAt.toISOString() };
}

export interface RedeemedInvite {
  staffUser: StaffUser;
  /** True while this member has neither a password nor a Google identity — the welcome screen's first step is then not optional. */
  needsSignInMethod: boolean;
}

/**
 * Exchanges an emailed token for the member it belongs to.
 *
 * Single-use is enforced by the UPDATE's own WHERE clause rather than a
 * read-then-write: two requests arriving together (a mail client
 * prefetching the link while the person clicks it) run the same
 * conditional update, and only one can match a row still unaccepted.
 *
 * Every failure — unknown, already used, replaced by a newer invite,
 * expired — gets the same message on purpose: the holder of a leaked
 * link learns nothing about which it was.
 */
export async function redeemStaffInvite(token: string): Promise<RedeemedInvite> {
  const [invite] = await db
    .update(staffInvites)
    .set({ acceptedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(staffInvites.tokenHash, hashToken(token)),
        isNull(staffInvites.acceptedAt),
        isNull(staffInvites.revokedAt),
        sql`${staffInvites.expiresAt} > now()`,
      ),
    )
    .returning();

  if (!invite) {
    throw new NotFoundError("That invite link is no longer valid — ask for a new one");
  }

  const [staffUser] = await db.$primary
    .select()
    .from(staffUsers)
    .where(eq(staffUsers.id, invite.staffUserId));

  if (!staffUser || !staffUser.isActive) {
    throw new ConflictError("That account is no longer active — ask whoever invited you");
  }

  return {
    staffUser,
    needsSignInMethod: staffUser.passwordHash === null && staffUser.googleSub === null,
  };
}
