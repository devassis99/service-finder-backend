import { uuid, varchar, timestamp, index } from "drizzle-orm/pg-core";
import { serviceFinderSchema } from "./_schema";
import { boUsers } from "./bo-users";
import { timestamps } from "./_helpers";

/**
 * Tracks issued refresh tokens so long-lived sessions can be revoked —
 * something a pure stateless JWT can't do before it naturally expires.
 * The access token stays a short-lived, stateless JWT (checked on every
 * request without a DB hit); only the refresh token, used rarely, costs
 * a lookup here.
 *
 * We never store the raw refresh token, only a SHA-256 hash of it (see
 * hashToken() in auth.service.ts) — same reasoning as never storing a
 * password in plaintext. Rotated on every use: refreshSession() revokes
 * the token it was handed and issues a new one, so a leaked,
 * already-used refresh token is useless.
 */
export const boRefreshTokens = serviceFinderSchema.table(
  "bo_refresh_tokens",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => boUsers.id, { onDelete: "cascade" }),
    tokenHash: varchar("token_hash", { length: 255 }).notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [index("bo_refresh_tokens_user_id_idx").on(table.userId)],
);

export type BoRefreshToken = typeof boRefreshTokens.$inferSelect;
export type NewBoRefreshToken = typeof boRefreshTokens.$inferInsert;
