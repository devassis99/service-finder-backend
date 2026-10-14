import { defineConfig } from "vitest/config";

/**
 * Unit-test config only — no real Postgres or Google involved. Every
 * service test mocks src/db directly (see src/test/mocks/drizzle.ts and
 * each *.test.ts file's own vi.mock calls), so the whole suite runs
 * in-process in milliseconds. That's what makes it cheap enough to run
 * on every commit (see .husky/pre-commit) instead of being pushed out to
 * the slower pre-push gate alongside build/lint.
 *
 * The env values below exist purely to satisfy config/env.ts's fail-fast
 * zod validation at import time (it throws if anything required is
 * missing) — they never reach a real Postgres/Google endpoint, because
 * the modules that would use them for that (src/db, modules/auth/google.ts)
 * are mocked in every test that imports them.
 *
 * Vitest merges these into process.env before any test file (or the
 * modules it imports) evaluates. config/env.ts's `import "dotenv/config"`
 * won't override them even if a real .env is present locally — dotenv
 * only fills in keys that aren't already set.
 *
 * That last point cuts both ways: this block must list EVERY variable
 * config/env.ts requires (no .optional(), no .default()). A missing one
 * is invisible on a developer's machine, where the real .env quietly
 * supplies it, and fails every suite at once on a CI runner that has no
 * .env at all. Adding a required variable to config/env.ts means adding
 * a fake one here in the same change.
 */
export default defineConfig({
  // Load the workspace packages (@service-finder/*) from their TypeScript
  // source, not their build, so `pnpm test` never runs against a stale
  // dist/. Vitest adds its own default conditions to this list.
  ssr: {
    resolve: {
      conditions: ["service-finder-source"],
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Clears mock.calls/mockReturnValueOnce queues between tests, but
    // keeps each mock's base implementation intact (unlike mockReset /
    // restoreMocks, which would wipe the default chain([]) fallback each
    // test's db mock is set up with).
    clearMocks: true,
    env: {
      NODE_ENV: "test",
      DATABASE_URL: "postgres://test:test@localhost:5433/service_finder_test",
      GOOGLE_CLIENT_ID: "test-google-client-id.apps.googleusercontent.com",
      JWT_SECRET: "test-jwt-secret-value-1234567890-abcdef",
      MFA_ENCRYPTION_KEY: "test-mfa-encryption-key-0123456789",
      // Set, and blank, so a developer's .env can't point unit tests at a
      // real Valkey. src/shared/rate-limit.test.ts talks to one only when
      // TEST_REDIS_URL is given — see that file.
      REDIS_URL: "",
    },
  },
});
