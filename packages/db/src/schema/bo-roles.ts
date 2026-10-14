import { uuid, varchar, text } from "drizzle-orm/pg-core";
import { serviceFinderSchema } from "./_schema";
import { timestamps } from "./_helpers";

export const boRoles = serviceFinderSchema.table("bo_roles", {
  id: uuid().primaryKey().defaultRandom(),
  name: varchar({ length: 100 }).notNull().unique(),
  description: text(),
  ...timestamps,
});

export type BoRole = typeof boRoles.$inferSelect;
export type NewBoRole = typeof boRoles.$inferInsert;
