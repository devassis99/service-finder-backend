import { uuid, varchar, boolean, text, timestamp, index } from "drizzle-orm/pg-core";
import { serviceFinderSchema } from "./_schema";
import { boRoles } from "./bo-roles";
import { timestamps } from "./_helpers";

/**
 * Service Finder's own internal/platform staff (back office) — the
 * people who log into the admin system itself: support, ops, whoever
 * approves new providers or handles billing. Not scoped to any one
 * business — these people operate across all of them.
 *
 * Each user has exactly one role (roleId). That role's permissions
 * (via bo_role_permissions) determine which endpoints they can call.
 * onDelete "restrict" on roleId means a role can't be deleted while
 * users are still assigned to it — they have to be reassigned first,
 * so nobody is silently left with no role at all.
 *
 * No password, by design. Back-office login is Google OAuth only —
 * googleSub is null for a pre-provisioned row (created by the seed
 * script or, later, an "invite" flow) until the matching email signs in
 * with Google for the first time and claims it. From then on, lookups
 * go by googleSub, not email, so a later email change on Google's side
 * can't silently steal or lose the binding. MFA is mandatory: mfaEnabled
 * stays false — and the account can't get a real access token — until
 * the user completes TOTP setup, enforced in auth.service.ts.
 */
export const boUsers = serviceFinderSchema.table(
  "bo_users",
  {
    id: uuid().primaryKey().defaultRandom(),
    roleId: uuid("role_id")
      .notNull()
      .references(() => boRoles.id, { onDelete: "restrict" }),
    name: varchar({ length: 255 }).notNull(),
    email: varchar({ length: 255 }).notNull().unique(),
    googleSub: varchar("google_sub", { length: 255 }).unique(),
    mfaEnabled: boolean("mfa_enabled").notNull().default(false),
    // Encrypted at rest (see mfa.ts) — never store a TOTP secret in
    // plaintext, it's equivalent to a permanent password otherwise.
    mfaSecret: text("mfa_secret"),
    mfaVerifiedAt: timestamp("mfa_verified_at", { withTimezone: true }),
    isActive: boolean("is_active").notNull().default(true),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [index("bo_users_role_id_idx").on(table.roleId)],
);

export type BoUser = typeof boUsers.$inferSelect;
export type NewBoUser = typeof boUsers.$inferInsert;
