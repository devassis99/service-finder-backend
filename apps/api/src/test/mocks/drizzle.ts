import { vi } from "vitest";

/**
 * A minimal stand-in for a Drizzle query/mutation builder chain. Every
 * builder method (.from/.where/.orderBy/...) returns the same object, so
 * calls can chain arbitrarily deep; the object is itself a resolved
 * Promise, so `await` at any point in the chain resolves to `rows` —
 * matching how real Drizzle builders are directly awaitable without a
 * separate `.execute()` call (e.g. `await db.select().from(x).where(y)`
 * and `await db.insert(x).values(y).returning()` both just work).
 *
 * Use this in test bodies to configure what a specific db call returns,
 * e.g.:
 *
 *   mockDb.$primary.select.mockReturnValueOnce(chain([existingRow]));
 *
 * Each *.test.ts file that needs a db mock also inlines an equivalent
 * (smaller) copy of this same logic inside its own `vi.hoisted()` block,
 * purely as the *default* fallback every mocked method returns before a
 * test overrides it — that copy has to be self-contained because a
 * `vi.mock(...)` factory can't reference something imported after Vitest
 * hoists the mock call above the rest of the file. This module is the one
 * tests actually import from for building per-call return values.
 */
export function chain<T>(rows: T) {
  const promise = Promise.resolve(rows) as Promise<T> &
    Record<string, (...args: unknown[]) => unknown>;
  const methods = [
    "from",
    "where",
    "orderBy",
    "innerJoin",
    "leftJoin",
    "rightJoin",
    "fullJoin",
    "limit",
    "offset",
    "groupBy",
    "having",
    "values",
    "set",
    "returning",
    "onConflictDoNothing",
    "onConflictDoUpdate",
  ];
  for (const method of methods) {
    (promise as unknown as Record<string, unknown>)[method] = vi.fn(() => promise);
  }
  return promise;
}

export interface QueryClientMock {
  select: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  execute: ReturnType<typeof vi.fn>;
  transaction: ReturnType<typeof vi.fn>;
}

/** Shape of the mocked `db` export from src/db/index.ts (withReplicas-wrapped Drizzle instance). */
export type DbMock = QueryClientMock & { $primary: QueryClientMock };
