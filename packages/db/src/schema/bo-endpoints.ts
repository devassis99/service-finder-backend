import { uuid, varchar, text, uniqueIndex } from "drizzle-orm/pg-core";
import { serviceFinderSchema } from "./_schema";
import { timestamps } from "./_helpers";

export const boHttpMethod = serviceFinderSchema.enum("bo_http_method", [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
]);

export const boEndpoints = serviceFinderSchema.table(
  "bo_endpoints",
  {
    id: uuid().primaryKey().defaultRandom(),
    method: boHttpMethod("method").notNull(),
    path: varchar({ length: 255 }).notNull(),
    name: varchar({ length: 255 }).notNull(),
    description: text(),
    ...timestamps,
  },
  (table) => [uniqueIndex("bo_endpoints_method_path_uq").on(table.method, table.path)],
);

export type BoEndpoint = typeof boEndpoints.$inferSelect;
export type NewBoEndpoint = typeof boEndpoints.$inferInsert;
