import { uuid, varchar, timestamp, smallint, index } from "drizzle-orm/pg-core";
import { serviceFinderSchema } from "./_schema";
import { staffUsers } from "./staff-users";
import { timestamps } from "./_helpers";

/**
 * One row per "email me a code" in the Security page's set/change
 * password flow, for someone without two-factor (with it, their
 * authenticator code is the check instead — see security.service.ts's
 * confirmSetPassword).
 *
 * Only codeHash is stored, never the code. A resend inserts a new row
 * rather than updating the last one, so `attempts` counts guesses
 * against one code and a burst of wrong guesses can't be reset by
 * asking for another.
 */
export const staffPasswordResetCodes = serviceFinderSchema.table(
  "staff_password_reset_codes",
  {
    id: uuid().primaryKey().defaultRandom(),
    staffUserId: uuid("staff_user_id")
      .notNull()
      .references(() => staffUsers.id, { onDelete: "cascade" }),
    // The address this code was sent to, whatever staff_users.email says
    // by the time it's checked.
    email: varchar({ length: 255 }).notNull(),
    codeHash: varchar("code_hash", { length: 255 }).notNull(),
    attempts: smallint().notNull().default(0),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [index("staff_password_reset_codes_staff_user_id_idx").on(table.staffUserId)],
);

export type StaffPasswordResetCode = typeof staffPasswordResetCodes.$inferSelect;
export type NewStaffPasswordResetCode = typeof staffPasswordResetCodes.$inferInsert;
