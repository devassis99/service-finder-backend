import { uuid, varchar } from "drizzle-orm/pg-core";
import { serviceFinderSchema } from "./_schema";
import { timestamps } from "./_helpers";

/**
 * A business on Service Finder — the tenant. Created by the business
 * app's sign-up (accounts.service.ts's signup), together with its owner
 * (the first staff_users row) and its default roles, in one transaction.
 *
 * Deliberately only identity and contact details for now. What a
 * business sells, where it works and how it is billed are its own areas
 * and arrive with them — a subscription (billing_prices) is the obvious
 * first one, linked from here once the business app has a checkout. Each
 * gets its own columns or table then, rather than placeholders now.
 */
export const accounts = serviceFinderSchema.table("accounts", {
  id: uuid().primaryKey().defaultRandom(),
  name: varchar({ length: 255 }).notNull(),
  // URL-safe, unique, derived from the name at sign-up and never changed
  // after — anything public that addresses a business (a booking page, a
  // profile link) will hang off it, and a link that moves when someone
  // renames their business is a broken link.
  slug: varchar({ length: 255 }).notNull().unique(),
  // The business's contact address — where account-level email goes.
  // Starts as the owner's sign-in email, but is the business's, not the
  // owner's: changing it never changes how anyone signs in.
  email: varchar({ length: 255 }).notNull(),
  phone: varchar({ length: 50 }),
  ...timestamps,
});

export type Account = typeof accounts.$inferSelect;
export type NewAccount = typeof accounts.$inferInsert;
