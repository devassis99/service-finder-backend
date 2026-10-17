import { uuid, varchar, text, boolean, index, uniqueIndex } from "drizzle-orm/pg-core";
import { serviceFinderSchema } from "./_schema";
import { accounts } from "./accounts";
import { timestamps } from "./_helpers";

/**
 * A named, per-business permission set a staff member is assigned —
 * real custom roles, the same model as iGroom's: every business has its
 * own rows, so "Dispatcher" at one business and "Dispatcher" at another
 * are unrelated, and an owner can rename, re-permission, delete or invent
 * roles freely.
 *
 * Every business always has exactly one isSystem=true role ("Owner",
 * seeded at sign-up — see staff-roles.service.ts's
 * seedDefaultRolesForAccount). It can't be deleted, renamed or edited
 * down from every permission, and the last active member holding it
 * can't be moved off it or deactivated — together that is what stops a
 * business locking itself out of its own team management.
 */
export const staffRoles = serviceFinderSchema.table(
  "staff_roles",
  {
    id: uuid().primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    name: varchar({ length: 100 }).notNull(),
    description: text(),
    isSystem: boolean("is_system").notNull().default(false),
    ...timestamps,
  },
  (table) => [
    index("staff_roles_account_id_idx").on(table.accountId),
    uniqueIndex("staff_roles_account_name_uq").on(table.accountId, table.name),
  ],
);

export type StaffRole = typeof staffRoles.$inferSelect;
export type NewStaffRole = typeof staffRoles.$inferInsert;
