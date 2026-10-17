import { uuid, varchar, boolean, timestamp, index, text } from "drizzle-orm/pg-core";
import { serviceFinderSchema } from "./_schema";
import { accounts } from "./accounts";
import { staffRoles } from "./staff-roles";
import { timestamps } from "./_helpers";

/**
 * A person who signs in to the business app. They belong to one account
 * (business), and their role (roleId → staff_roles) decides what they can
 * do there. The owner created at sign-up is simply the first row,
 * assigned the business's "Owner" role.
 *
 * Email is globally unique — it's what sign-in looks up by, so a lookup
 * is always unambiguous. Stored lowercased (the validators normalise it),
 * so "Jo@Example.com" and "jo@example.com" are the same person. Revisit
 * only if one person working for several businesses becomes a feature.
 *
 * passwordHash and googleSub are both optional, and an invited row has
 * neither until its owner sets one up through the emailed invite (see
 * staff_invites). At least one has to exist to sign in — enforced in the
 * services, not the schema.
 *
 * Two-factor is optional here, unlike the back office: mfaEnabled stays
 * false until the person turns it on from Security settings. The three
 * columns are the same shape as bo_users', and the same encryption
 * (modules/auth/mfa.ts) protects the secret.
 */
export const staffUsers = serviceFinderSchema.table(
  "staff_users",
  {
    id: uuid().primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    name: varchar({ length: 255 }).notNull(),
    email: varchar({ length: 255 }).notNull().unique(),
    // "salt:hash" hex, scrypt — see modules/accounts/password.ts. Null for
    // someone who has only ever signed in with Google, or not at all yet.
    passwordHash: varchar("password_hash", { length: 255 }),
    googleSub: varchar("google_sub", { length: 255 }).unique(),
    // No onDelete, so Postgres's default NO ACTION: a role still held by
    // someone can't be deleted out from under them (staff-roles.service.ts
    // refuses it first, with a readable message). Not RESTRICT, which is
    // checked mid-statement: deleting a whole account cascades to both
    // its roles and its staff, and RESTRICT would trip on whichever role
    // went first. NO ACTION waits for the end of the statement, by when
    // the staff rows are gone too.
    roleId: uuid("role_id").references(() => staffRoles.id),
    isActive: boolean("is_active").notNull().default(true),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    mfaEnabled: boolean("mfa_enabled").notNull().default(false),
    // Encrypted at rest — a TOTP secret in plaintext is a permanent
    // password. See modules/auth/mfa.ts.
    mfaSecret: text("mfa_secret"),
    mfaVerifiedAt: timestamp("mfa_verified_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index("staff_users_account_id_idx").on(table.accountId),
    index("staff_users_role_id_idx").on(table.roleId),
  ],
);

export type StaffUser = typeof staffUsers.$inferSelect;
export type NewStaffUser = typeof staffUsers.$inferInsert;
