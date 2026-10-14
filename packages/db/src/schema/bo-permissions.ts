import { uuid, varchar, text } from "drizzle-orm/pg-core";
import { serviceFinderSchema } from "./_schema";
import { timestamps } from "./_helpers";

export const boPermissions = serviceFinderSchema.table("bo_permissions", {
  id: uuid().primaryKey().defaultRandom(),
  key: varchar({ length: 100 }).notNull().unique(),
  name: varchar({ length: 255 }).notNull(),
  description: text(),
  ...timestamps,
});

export type BoPermission = typeof boPermissions.$inferSelect;
export type NewBoPermission = typeof boPermissions.$inferInsert;
