import { pgSchema } from "drizzle-orm/pg-core";

/**
 * Every table in this app lives inside this Postgres schema instead of
 * the default `public` schema. Using `.table()`/`.enum()` off this object
 * (instead of the bare `pgTable`/`pgEnum`) means the schema itself is part
 * of the generated migration SQL (`CREATE SCHEMA IF NOT EXISTS ...`), so
 * it gets created automatically wherever this migration runs — dev, test,
 * staging, prod — nothing needs to be created by hand.
 */
export const serviceFinderSchema = pgSchema("service_finder");
