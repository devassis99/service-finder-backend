import { uuid, varchar, timestamp, index, text } from "drizzle-orm/pg-core";
import { serviceFinderSchema } from "./_schema";
import { staffUsers } from "./staff-users";
import { timestamps } from "./_helpers";

/**
 * Business-app refresh tokens — bo_refresh_tokens' design (only the
 * sha256 is stored; single-use, rotated on every refresh) but its own
 * table, so a back-office session and a business session can never be
 * revoked through the same rows.
 *
 * Every live (unrevoked, unexpired) row is one signed-in session, so the
 * Security page's "Active sessions" list reads straight from here.
 * userAgent exists only to give that list something human to show.
 */
export const accountRefreshTokens = serviceFinderSchema.table(
  "account_refresh_tokens",
  {
    id: uuid().primaryKey().defaultRandom(),
    staffUserId: uuid("staff_user_id")
      .notNull()
      .references(() => staffUsers.id, { onDelete: "cascade" }),
    tokenHash: varchar("token_hash", { length: 255 }).notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    userAgent: text("user_agent"),
    ...timestamps,
  },
  (table) => [index("account_refresh_tokens_staff_user_id_idx").on(table.staffUserId)],
);

export type AccountRefreshToken = typeof accountRefreshTokens.$inferSelect;
export type NewAccountRefreshToken = typeof accountRefreshTokens.$inferInsert;
