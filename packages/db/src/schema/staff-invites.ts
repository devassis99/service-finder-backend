import { uuid, varchar, timestamp, index } from "drizzle-orm/pg-core";
import { serviceFinderSchema } from "./_schema";
import { staffUsers } from "./staff-users";
import { timestamps } from "./_helpers";

/**
 * A single-use link emailed to someone a business has invited, which
 * lets them claim their staff_users row and set themselves up — the same
 * design as iGroom's:
 *   - only the sha256 of the token is stored, never the token, so a
 *     database leak hands out no working invites;
 *   - acceptedAt is set by a conditional UPDATE rather than a
 *     read-then-write, which is what makes redemption single-use even
 *     when two requests arrive together (a mail client prefetching the
 *     link while the person clicks it);
 *   - the token travels in the link's fragment (/invite#<token>), so it
 *     never reaches a server log or a Referer header.
 *
 * Seven days, to survive a weekend and a spam folder. Resending or
 * copying a fresh link retires every outstanding invite for that person
 * (revokedAt), so an older forwarded email stops working the moment a
 * new one exists.
 */
export const staffInvites = serviceFinderSchema.table(
  "staff_invites",
  {
    id: uuid().primaryKey().defaultRandom(),
    staffUserId: uuid("staff_user_id")
      .notNull()
      .references(() => staffUsers.id, { onDelete: "cascade" }),
    /** sha256 hex of the emailed token — never the token itself. */
    tokenHash: varchar("token_hash", { length: 64 }).notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    /** Set exactly once, by a conditional UPDATE — what makes the link single-use. */
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    /** Set when a newer invite supersedes this one. Kept rather than deleted, so "replaced" and "never existed" stay distinguishable. */
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    /** Who sent it. Null if that person has since been removed. */
    invitedByStaffUserId: uuid("invited_by_staff_user_id").references(() => staffUsers.id, {
      onDelete: "set null",
    }),
    ...timestamps,
  },
  (table) => [index("staff_invites_staff_user_id_idx").on(table.staffUserId)],
);

export type StaffInvite = typeof staffInvites.$inferSelect;
export type NewStaffInvite = typeof staffInvites.$inferInsert;
