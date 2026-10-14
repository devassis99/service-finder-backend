import { timestamp } from "drizzle-orm/pg-core";

/**
 * Standard created_at / updated_at pair — spread this into every table
 * so timestamp handling stays identical everywhere:
 *   export const foo = pgTable("foo", { ...timestamps, ... })
 *
 * `withTimezone: true` (Postgres `timestamptz`) on every one of these,
 * and on every other absolute-time column in this schema, is deliberate
 * and not optional.
 *
 * A bare `timestamp` stores six digits and no zone, so node-postgres —
 * which serialises a JS Date using the *Node process's* local clock —
 * writes a different value for the same instant depending on what TZ the
 * app server happens to be running under. It reads back correctly only
 * while every writer and reader shares that TZ forever; a deploy to a
 * differently-zoned box, a second worker, psql, or any BI tool silently
 * reads every row off by the offset. `timestamptz` normalises to UTC at
 * write time, so the row holds a real instant no matter who wrote it.
 *
 * Rule of thumb for this schema: an *instant* (an appointment's start,
 * a token's expiry, an audit stamp) is timestamptz. A *rule* written in
 * wall-clock terms (a provider's "open 09:00", a "YYYY-MM-DD" day off)
 * stays a plain string and is resolved against the place's own timezone
 * only when a calendar is drawn — never stored as an instant it isn't.
 */
export const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
};
